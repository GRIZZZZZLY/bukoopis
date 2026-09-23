import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  streamQuickStart,
  type QuickStartStageEvent,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/labels";
import { finishJob, startJob, updateJob } from "@/lib/jobs";


const STATUS_LABELS: Record<string, string> = {
  started: "собирается…",
  done: "готово",
  skipped: "пропущен",
  failed: "не собрался",
};

interface Row {
  stageId: string;
  status: string;
  message?: string;
}

/** «3 мин 12 с» — крупная часть впереди, как в прогрессе приёма материала. */
function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(s / 60);
  return min > 0 ? `${min} мин ${s % 60} с` : `${s} с`;
}

/** Часы идущего сбора. Один вызов агента молчит минутами, и без бегущего
 *  времени экран неотличим от зависшего. */
function useElapsed(startedAt: string | undefined): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (startedAt === undefined) return undefined;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return undefined;
  return formatElapsed(now - started);
}

interface Props {
  bookId: number;
  /** Сбор закончился — страница перечитывает состояние. */
  onFinished: () => void;
}

export function QuickStartPanel({ bookId, onFinished }: Props) {
  const [running, setRunning] = useState(false);
  /** Сбор идёт, но начат не здесь: подхвачен у сервера после перезагрузки. */
  const [adopted, setAdopted] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [startedAt, setStartedAt] = useState<string | undefined>(undefined);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishedNote, setFinishedNote] = useState<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const elapsed = useElapsed(startedAt);

  // Поток видит только та вкладка, которая его открыла, а сбор живёт в
  // процессе сервера. Спрашиваем при монтировании и, пока идёт, раз в 2 с.
  const adopt = useCallback(async () => {
    try {
      const run = await api.getQuickStartInflight(bookId);
      if (run) {
        setAdopted(true);
        setRunning(true);
        setTotal(run.total);
        setStartedAt(run.startedAt);
        setRows(run.rows.filter(Boolean));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [bookId]);

  useEffect(() => {
    let alive = true;
    void adopt().then((found) => {
      if (!alive || !found) return;
    });
    return () => {
      alive = false;
    };
  }, [adopt]);

  useEffect(() => {
    if (!adopted || !running) return;
    const t = setInterval(() => {
      void api
        .getQuickStartInflight(bookId)
        .then((run) => {
          if (run) {
            setTotal(run.total);
            setRows(run.rows.filter(Boolean));
            return;
          }
          // Прогон исчез из реестра — значит, закончился. Итог достался той
          // вкладке, которая открывала поток; этой остаётся перечитать книгу.
          setRunning(false);
          setAdopted(false);
          setStopping(false);
          setFinishedNote("Сбор завершён");
          onFinishedRef.current();
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [adopted, running, bookId]);

  // Идущий сбор виден в верхней панели.
  const jobRef = useRef<number | null>(null);
  const doneStages = rows.filter((r) => r && r.status !== "started").length;
  useEffect(() => {
    if (!running) return;
    jobRef.current = startJob({ label: "Быстрый сбор" });
    return () => {
      if (jobRef.current !== null) finishJob(jobRef.current);
      jobRef.current = null;
    };
  }, [running]);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (jobRef.current === null) return;
    updateJob(jobRef.current, {
      label: stopping
        ? "Быстрый сбор · останавливаю…"
        : `Быстрый сбор · ${doneStages} из ${total || "?"}`,
      onStop: stopping ? undefined : () => stopRef.current(),
    });
  }, [doneStages, total, stopping, running]);

  async function onStart() {
    setError(null);
    setFinishedNote(null);
    setRows([]);
    setStopping(false);
    setRunning(true);
    setStartedAt(new Date().toISOString());
    try {
      await streamQuickStart(bookId, {
        onBegin: (p) => setTotal(p.total),
        onStage: (e: QuickStartStageEvent) => {
          setRows((prev) => {
            const next = [...prev];
            next[e.index] = {
              stageId: e.stageId,
              status: e.status,
              ...(e.message !== undefined ? { message: e.message } : {}),
            };
            return next;
          });
        },
        onDone: (p) => {
          setFinishedNote(p.cancelled ? "Сбор остановлен" : "Сбор завершён");
          onFinishedRef.current();
        },
        onError: (message) => setError(message),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setAdopted(false);
      setStopping(false);
    }
  }

  async function onStop() {
    setStopping(true);
    try {
      await api.cancelQuickStart(bookId);
    } catch {
      // 404 значит «сбор уже кончился сам» — сообщать не о чем.
    }
  }

  stopRef.current = () => void onStop();

  return (
    <div className="quick" aria-label="Быстрый сбор">
      {running ? (
        <Button onClick={() => void onStop()} disabled={stopping} variant="secondary">
          Остановить
        </Button>
      ) : (
        <Button onClick={() => void onStart()} variant="secondary">
          Собрать всё до первой главы
        </Button>
      )}
      <p className="quick-note">
        Модель пройдёт этапы сама и подготовит черновики. Ничего не утверждает
        и глав не создаёт — это ваш выбор.
      </p>

      {running && (
        <p>
          Собираем этапы… {rows.filter((r) => r && r.status !== "started").length} из {total}
          {elapsed !== undefined && <span className="muted">{` · идёт ${elapsed}`}</span>}
        </p>
      )}
      {running && adopted && (
        <p className="muted" style={{ fontSize: 12 }}>
          Сбор начат раньше и идёт на сервере — эта вкладка показывает его состояние.
        </p>
      )}
      {stopping && (
        <p className="muted" style={{ fontSize: 12 }}>
          Остановимся перед следующим этапом: прервать идущий вызов нечем.
        </p>
      )}

      {rows.length > 0 && (
        <ul style={{ display: "grid", gap: 4, paddingLeft: 0, listStyle: "none" }}>
          {rows.map((row, i) =>
            row ? (
              <li key={i} style={{ fontSize: 13 }}>
                <strong>{STAGE_LABELS[row.stageId as keyof typeof STAGE_LABELS] ?? row.stageId}</strong>
                <span className="muted">
                  {" — "}
                  {STATUS_LABELS[row.status] ?? row.status}
                  {row.message !== undefined && `: ${row.message}`}
                </span>
              </li>
            ) : null,
          )}
        </ul>
      )}

      {finishedNote && !running && <p className="text-sm">{finishedNote}</p>}
      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--color-ink-red)" }}>
          Ошибка: {error}
        </p>
      )}
    </div>
  );
}
