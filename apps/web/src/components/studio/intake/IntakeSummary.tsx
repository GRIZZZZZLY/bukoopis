import { Link } from "react-router-dom";
import type { IntakeTarget } from "@book-forge/shared";
import type { IntakeResponse } from "@/api/client";

interface Props {
  result: IntakeResponse;
  bookId: number;
  onDismiss: () => void;
}

function targetHref(bookId: number, target: IntakeTarget): string | undefined {
  if (target === "concept") return `/books/${bookId}/studio`;
  if (target === "chapters") return `/books/${bookId}/studio/chapters`;
  if (target === "skip") return undefined;
  return `/books/${bookId}/studio/${target}`;
}

/** Что и куда легло. Единственная задача — чтобы автор увидел результат и знал,
 *  что решение осталось за ним. */
export function IntakeSummary({ result, bookId, onDismiss }: Props) {
  return (
    <div className="card intake-summary" aria-label="Что легло из материалов">
      <h3>Материалы разобраны</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Всё легло черновиками — ничего не утверждено. Откройте этап и примите то, что подходит;
        главы станут текстом книги, когда вы сохраните их в редакторе.
      </p>

      {result.summary.length === 0 ? (
        <p className="muted">В файлах не нашлось ничего, что ложится на этапы.</p>
      ) : (
        <ul className="intake-summary-list">
          {result.summary.map((row) => {
            const href = targetHref(bookId, row.target);
            return (
              <li key={row.target}>
                <span className="intake-summary-head">
                  {href ? <Link to={href}>{row.label}</Link> : row.label}
                  <span className="pill tabular">{row.count}</span>
                </span>
                <span className="muted">{row.titles.join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      )}

      {(result.warnings?.length ?? 0) > 0 && (
        // Легло, но сверить надо: главу модель переписала, а не перенесла
        // дословно (F03). Черновик до сохранения ни на что не влияет.
        <div className="intake-summary-failures">
          <p>Проверьте перед сохранением:</p>
          <ul>
            {result.warnings!.map((w, index) => (
              <li key={index}>
                <span className="intake-summary-failed-name">{w.title}</span> — {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.failures.length > 0 && (
        // Причина отказа приходит с сервера по файлу и раньше выбрасывалась:
        // автор видел одни имена и не мог узнать, чинить ему файл, повторять
        // попытку или ждать. Показываем ровно то, что сервер сказал.
        <div role="alert" className="intake-summary-failures">
          <p>Не удалось разобрать:</p>
          <ul>
            {/* Ключ по номеру: в брошенной папке два файла из разных подпапок
                легко зовутся одинаково. */}
            {result.failures.map((f, index) => (
              <li key={index}>
                <span className="intake-summary-failed-name">{f.filename}</span>
                {f.message ? ` — ${f.message}` : ""}
              </li>
            ))}
          </ul>
          <p className="muted">Их можно перетащить ещё раз.</p>
        </div>
      )}

      <button type="button" className="btn btn-primary" onClick={onDismiss}>
        Понятно
      </button>
    </div>
  );
}
