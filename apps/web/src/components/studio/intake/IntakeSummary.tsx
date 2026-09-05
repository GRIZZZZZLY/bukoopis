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
        Всё легло черновиками — ничего не утверждено. Откройте этап и примите то, что подходит.
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

      {result.failures.length > 0 && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13 }}>
          Не удалось разобрать: {result.failures.map((f) => f.filename).join(", ")}. Их можно
          перетащить ещё раз.
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={onDismiss}>
        Понятно
      </button>
    </div>
  );
}
