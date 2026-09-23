import { coverPalette } from "@/lib/shelf";
import type { ShelfBook } from "./coverArt";

/** Плоская витрина: если WebGL не завёлся (старая видеокарта, отключённое
 *  ускорение) — те же книги лицом и тот же разворот, только без 3D. */
export function ShelfFlat({
  books,
  openId,
  focusIndex,
  onPick,
}: {
  books: ShelfBook[];
  openId: number | null;
  focusIndex: number;
  onPick: (id: number | null) => void;
}) {
  const open = books.find((b) => b.id === openId) ?? null;
  return (
    <div className="flatshelf">
      <ul className="flatshelf-row" aria-label="Книги на полке">
        {books.map((b, i) => {
          const pal = coverPalette(b.seed);
          return (
            <li key={b.id}>
              <button
                type="button"
                className={`flatcover ${i === focusIndex ? "flatcover-focus" : ""}`}
                style={{ background: `radial-gradient(ellipse at 55% 40%, ${pal.base}, ${pal.dark})`, color: pal.foil }}
                onClick={() => onPick(b.id)}
                aria-label={`${b.title} — раскрыть`}
              >
                <span className="flatcover-frame" style={{ borderColor: pal.foil }} />
                <span className="flatcover-title">{b.title}</span>
                {b.genre && <span className="flatcover-genre">{b.genre}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {open && <BookSpread book={open} />}
    </div>
  );
}

/** Разворот раскрытой книги текстом: титульный лист и аннотация. Им же
 *  пользуется чтение с экрана поверх 3D-витрины. */
export function BookSpread({ book, className = "spread" }: { book: ShelfBook; className?: string }) {
  return (
    <article className={className} aria-label={`Книга «${book.title}»`}>
      <section className="spread-page spread-title">
        <h2>{book.title}</h2>
        {book.genre && <p className="spread-genre">{book.genre}</p>}
        <dl>
          {book.meta.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="spread-page spread-annotation">
        <h3>Аннотация</h3>
        {book.annotation ? (
          book.annotation.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p className="spread-empty">Аннотация появится, когда вы утвердите замысел в Мастерской.</p>
        )}
      </section>
    </article>
  );
}
