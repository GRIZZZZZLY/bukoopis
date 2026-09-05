import { useEffect, useState } from "react";
import { INTAKE_TARGET_LABELS, type IntakeTarget } from "@book-forge/shared";

export interface IntakeProgressRow {
  filename: string;
  status: "running" | "done" | "failed";
  /** Только для `status: "done"`. */
  targets?: IntakeTarget[];
  /** Только для `status: "failed"`. */
  message?: string;
}

/** «3 мин 12 с» — крупная часть впереди, чтобы читалось с одного взгляда. */
function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(s / 60);
  return min > 0 ? `${min} мин ${s % 60} с` : `${s} с`;
}

/** Часы идущего разбора. Один вызов классификатора на большой части молчит
 *  минутами, и без бегущего времени экран неотличим от зависшего. */
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
  total: number;
  rows: IntakeProgressRow[];
  /** ISO-время начала прогона; без него часы не показываются. */
  startedAt?: string;
  /** Разбор идёт не в этой вкладке — она подхватила его у сервера после
   *  обновления страницы. Формулировки те же, добавляется только пояснение,
   *  откуда взялся прогресс. */
  adopted?: boolean;
  /** Отмена запрошена: кнопка отработала, файл, который уже читается, всё
   *  равно дочитается — прервать вызов LLM на середине нечем. */
  stopping: boolean;
  /** Прогон уже назвал свой ключ — есть что останавливать. До этого кнопка
   *  живой быть не должна: клик по ней всё равно ничего бы не сделал. */
  canStop: boolean;
  onStop: () => void;
}

/** Живой прогресс разбора: один файл — одна строка, статус меняется по мере
 *  событий сервера. «Остановить» не обещает мгновенной остановки — только
 *  то, что реально можно обещать: следующий файл не начнётся. */
export function IntakeProgress({
  total,
  rows,
  startedAt,
  adopted,
  stopping,
  canStop,
  onStop,
}: Props) {
  const finished = rows.filter((row) => row.status !== "running").length;
  const elapsed = useElapsed(startedAt);

  return (
    <div className="card intake-progress" aria-label="Разбор материалов">
      <p>
        Разбираем материалы… {finished} из {total}
        {elapsed !== undefined && <span className="muted">{` · идёт ${elapsed}`}</span>}
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        {adopted
          ? "Разбор начат раньше и идёт на сервере — эта вкладка показывает его состояние."
          : "Разбор идёт на сервере: страницу можно обновить или закрыть, он не прервётся."}
      </p>
      <ul className="intake-progress-list">
        {/* Ключ по номеру строки, а не по имени: в брошенной папке два файла
            из разных подпапок легко зовутся одинаково, и React ругался бы на
            повторяющийся ключ. Порядок строк задаёт сервер и не меняется. */}
        {rows.map((row, index) => (
          <li
            key={index}
            className={
              "intake-progress-row" +
              (row.status === "done" ? " is-done" : "") +
              (row.status === "failed" ? " is-failed" : "")
            }
          >
            <span className="mark">
              {row.status === "running" ? "⟳" : row.status === "done" ? "✓" : "✗"}
            </span>
            <span>
              <span className="intake-progress-name">{row.filename}</span>
              {row.status === "done" && row.targets && row.targets.length > 0 && (
                <span className="intake-progress-where">
                  {" — " + row.targets.map((t) => INTAKE_TARGET_LABELS[t]).join(", ")}
                </span>
              )}
              {row.status === "failed" && row.message && (
                <span className="intake-progress-why">{" — " + row.message}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={stopping || !canStop}
        onClick={onStop}
      >
        {stopping ? "Останавливаем…" : "Остановить"}
      </button>
      {stopping && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Текущий файл дочитаем, следующие не начнём.
        </p>
      )}
    </div>
  );
}
