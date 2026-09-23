import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, type IntakeFile, type IntakeResponse } from "@/api/client";
import { DropZone } from "./DropZone";
import { IntakeProgress, type IntakeProgressRow } from "./IntakeProgress";
import { IntakeSummary } from "./IntakeSummary";
import { finishJob, startJob, updateJob } from "@/lib/jobs";

interface Props {
  bookId: number;
  onIntake: () => void;
}

type IntakeResult = IntakeResponse & { cancelled: boolean };

/** `btoa(String.fromCharCode(...new Uint8Array(buf)))` blows the call stack on
 *  any real file — the spread passes every byte as its own function argument,
 *  and that ceiling sits around 100 KB of arguments, well under one chapter's
 *  worth of .docx. `FileReader.readAsDataURL` does the base64 encoding
 *  natively, so no byte ever becomes a JS function argument; the payload is
 *  the data URL's content after its comma. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

/** Чтение файлов и один разбор по SSE. Панель ничего не решает сама: результат
 *  показывается автору, а страница перезагружает этапы. Прогресс живёт здесь
 *  же — `onBegin`/`onFile` только копят строки, `IntakeProgress` их рисует. */
export function IntakePanel({ bookId, onIntake }: Props) {
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState<string | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<IntakeProgressRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [startedAt, setStartedAt] = useState<string | undefined>(undefined);
  // Разбор идёт, но начала его не эта вкладка: она подхватила его у сервера
  // после обновления страницы и теперь опрашивает состояние. Своего потока
  // событий у неё нет — итог она узнает по тому, что разбор пропал из реестра.
  const [adopted, setAdopted] = useState(false);
  const [finishedElsewhere, setFinishedElsewhere] = useState(false);
  // Опрос не должен пережить размонтирование панели и не должен запускаться
  // дважды на один подхваченный прогон.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function stopPolling() {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }

    function applySnapshot(run: NonNullable<Awaited<ReturnType<typeof api.intakeInflight>>>) {
      setRequestKey(run.requestKey);
      setTotal(run.total);
      setStartedAt(run.startedAt);
      setRows(
        run.rows.map((row) => ({
          filename: row.filename,
          status: row.status === "started" ? ("running" as const) : row.status,
          ...(row.targets !== undefined ? { targets: row.targets } : {}),
          ...(row.message !== undefined ? { message: row.message } : {}),
        })),
      );
      setAdopted(true);
      setStreaming(true);
    }

    void (async () => {
      let run;
      try {
        run = await api.intakeInflight(bookId);
      } catch {
        // Реестр не ответил — это не повод пугать автора: он ничего не
        // запускал в этой вкладке. Просто не подхватываем.
        return;
      }
      if (cancelled || !run) return;
      applySnapshot(run);

      pollRef.current = setInterval(() => {
        void (async () => {
          let next;
          try {
            next = await api.intakeInflight(bookId);
          } catch {
            return; // одна неудачная проверка — не конец разбора
          }
          if (cancelled) return;
          if (!next) {
            // Пропал из реестра — значит закончился. Итога у подхватившей
            // вкладки нет (его получила та, что открывала поток), поэтому
            // говорим прямо: разбор закончен, материал на этапах.
            stopPolling();
            setStreaming(false);
            setAdopted(false);
            setFinishedElsewhere(true);
            onIntake();
            return;
          }
          applySnapshot(next);
        })();
      }, 2000);
    })();

    return () => {
      cancelled = true;
      stopPolling();
    };
    // onIntake пересоздаётся на каждый рендер страницы этапа — включать его в
    // зависимости значило бы перезапускать опрос без причины.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Идущий разбор виден в верхней панели на любой странице дома книги.
  const jobRef = useRef<number | null>(null);
  const doneCount = rows.filter((r) => r.status === "done" || r.status === "failed").length;
  const jobLabel = `Разбор материалов · ${doneCount} из ${total}`;
  const live = streaming && !result;
  useEffect(() => {
    if (!live) return;
    jobRef.current = startJob({ label: jobLabel });
    return () => {
      if (jobRef.current !== null) finishJob(jobRef.current);
      jobRef.current = null;
    };
    // Подпись обновляет второй эффект: этот только открывает и закрывает.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (jobRef.current === null) return;
    updateJob(jobRef.current, {
      label: stopping ? "Разбор материалов · останавливаю…" : jobLabel,
      // Стоп доступен, когда сервер назвал прогон, и пока остановка не ушла.
      onStop: requestKey !== undefined && !stopping ? () => stopRef.current() : undefined,
    });
  }, [jobLabel, requestKey, stopping]);

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);
    setRows([]);
    setTotal(0);
    setStopping(false);
    setStopError(null);
    setRequestKey(undefined);
    setFinishedElsewhere(false);
    setAdopted(false);
    setStartedAt(new Date().toISOString());
    try {
      // По одному файлу, а не Promise.all: одна нечитаемая запись отбивала
      // весь пакет, и автор терял всё перетаскивание. Сервер и так живёт
      // по-файлово — клиент должен вести себя так же.
      const payload: IntakeFile[] = [];
      const unread: Array<{ filename: string; message: string }> = [];
      for (const f of files) {
        try {
          payload.push(
            f.name.toLowerCase().endsWith(".docx")
              ? { filename: f.name, contentBase64: await fileToBase64(f) }
              : { filename: f.name, content: await f.text() },
          );
        } catch (e) {
          unread.push({
            filename: f.name,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (payload.length === 0) {
        // Звать сервер не с чем — но автору всё равно надо сказать, что именно
        // не прочиталось, теми же словами, что и про отказы сервера.
        setBusy(false);
        setResult({ summary: [], ideaSet: false, chapters: [], failures: unread, revision: 0, cancelled: false });
        return;
      }

      // Число файлов известно сразу — начальная оценка, `onBegin` тут же
      // подтверждает её сервером. Переключаемся на прогресс сразу, ещё до
      // ответа сервера: flushSync, а не обычный setState, потому что дальше
      // события идут по одному в реальном времени (секунды между файлами —
      // минуты на весь прогон), и обычный батчинг откладывал бы commit до
      // следующего цикла React — автор увидел бы не живой прогресс, а редкие
      // скачки. Каждое событие обязано попасть на экран сразу, как пришло.
      flushSync(() => {
        setTotal(payload.length);
        setStreaming(true);
      });

      const out = await api.intakeStream(bookId, payload, {
        onBegin: (e) => {
          flushSync(() => {
            setRequestKey(e.requestKey);
            setTotal(e.total);
          });
        },
        onFile: (e) => {
          flushSync(() => {
            setRows((prev) => {
              if (e.status === "started") {
                return [...prev, { filename: e.filename, status: "running" }];
              }
              const next = [...prev];
              next[e.index] = {
                filename: e.filename,
                status: e.status,
                ...(e.targets !== undefined ? { targets: e.targets } : {}),
                ...(e.message !== undefined ? { message: e.message } : {}),
              };
              return next;
            });
          });
        },
      });
      // Нечитаемые файлы встают рядом с тем, о чём отчитался сервер: для автора
      // это один и тот же вопрос — что из брошенного не дошло. Флаги
      // busy/streaming/stopping/requestKey намеренно не сбрасываются здесь:
      // как только `result` не пуст, рендер ниже безусловно показывает
      // сводку — их значения уже не смотрят на экран.
      setResult({ ...out, failures: [...unread, ...out.failures] });
      onIntake();
    } catch (e) {
      // Оборвался поток — не значит, что оборвался разбор: он живёт в
      // процессе сервера (С14 ревью 2026-09-19). Прежде вкладка забывала о
      // нём и рисовала зону перетаскивания, приглашая начать второй прогон
      // поверх идущего.
      let stillRunning = null;
      try {
        stillRunning = await api.intakeInflight(bookId);
      } catch {
        /* реестр не ответил — ведём себя как раньше */
      }
      if (stillRunning) {
        setRequestKey(stillRunning.requestKey);
        setTotal(stillRunning.total);
        setStartedAt(stillRunning.startedAt);
        setAdopted(true);
        setStreaming(true);
        setError(
          "Связь с сервером оборвалась, но разбор продолжается. Показываем его ход.",
        );
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setStreaming(false);
      setStopping(false);
      setRequestKey(undefined);
    }
  }

  async function handleStop() {
    if (!requestKey) return;
    setStopping(true);
    setStopError(null);
    try {
      await api.cancelIntake(bookId, requestKey);
    } catch {
      // Отмена не дошла — оставлять кнопку «Останавливаем…» навечно было бы
      // враньём (разбор идёт как ни в чём не бывало). Возвращаем кнопку в
      // рабочее состояние и говорим прямо, что попытка не удалась и её можно
      // повторить.
      setStopping(false);
      setStopError("Не удалось остановить разбор — попробуйте ещё раз.");
    }
  }

  stopRef.current = () => void handleStop();

  function dismissResult() {
    // Флаги прогона сбрасываются здесь, а не сразу по приходу ответа: пока
    // видна сводка, их значения ни на что не влияют (рендер ниже смотрит
    // только на `result`), а сбрасывать их раньше не даёт ничего, кроме
    // риска перетереть значение, которое ещё нужно (например, requestKey —
    // для клика «Остановить», который может прийти чуть позже ответа).
    setResult(null);
    setBusy(false);
    setStreaming(false);
    setStopping(false);
    setStopError(null);
    setRequestKey(undefined);
    setStartedAt(undefined);
  }

  if (finishedElsewhere) {
    return (
      <div className="card" aria-label="Разбор завершён">
        <h3>Разбор завершён</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Он шёл на сервере и закончился. Всё легло черновиками — откройте этапы и примите то,
          что подходит.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setFinishedElsewhere(false)}>
          Понятно
        </button>
      </div>
    );
  }

  if (result) {
    return (
      <>
        {result.cancelled && (
          <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Разбор остановлен, сохранили то, что успели.
          </p>
        )}
        <IntakeSummary result={result} bookId={bookId} onDismiss={dismissResult} />
      </>
    );
  }

  return (
    <div className="card" aria-label="Приём материалов">
      {streaming ? (
        <>
          <IntakeProgress
            total={total}
            rows={rows}
            {...(startedAt !== undefined ? { startedAt } : {})}
            adopted={adopted}
            stopping={stopping}
            canStop={requestKey !== undefined}
            onStop={() => void handleStop()}
          />
          {stopError && (
            <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 12, marginTop: 6 }}>
              {stopError}
            </p>
          )}
        </>
      ) : (
        <DropZone onFiles={(f) => void handleFiles(f)} busy={busy} />
      )}
      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
