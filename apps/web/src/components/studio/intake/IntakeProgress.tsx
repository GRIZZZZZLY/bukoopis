import { INTAKE_TARGET_LABELS, type IntakeTarget } from "@book-forge/shared";

export interface IntakeProgressRow {
  filename: string;
  status: "running" | "done" | "failed";
  /** Только для `status: "done"`. */
  targets?: IntakeTarget[];
  /** Только для `status: "failed"`. */
  message?: string;
}

interface Props {
  total: number;
  rows: IntakeProgressRow[];
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
export function IntakeProgress({ total, rows, stopping, canStop, onStop }: Props) {
  const finished = rows.filter((row) => row.status !== "running").length;

  return (
    <div className="card intake-progress" aria-label="Разбор материалов">
      <p>
        Разбираем материалы… {finished} из {total}
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
