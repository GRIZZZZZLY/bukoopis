(function(){
// app/pages/books.jsx — Books list

const { BOOKS } = window.LW_DATA;
const { cn: cnB, Button, Pill, I, Dot } = window.LW;

function BookSpine({ title }) {
  return (
    <div className="spine">
      <span className="spine-emboss mono">{title}</span>
    </div>
  );
}

function BookCard({ b }) {
  const statusPill = b.status === "active"
    ? <Pill tone="blue">активна</Pill>
    : b.status === "draft"
    ? <Pill tone="amber">черновик</Pill>
    : <Pill tone="muted">архив</Pill>;
  return (
    <a href={`#/books/${b.id}/studio`} className="bookcard">
      <BookSpine title={b.title} />
      <div className="bookcard-body paper-grain">
        <div className="bookcard-meta cap-upper">{b.genre} · {b.audience}</div>
        <h2 className="bookcard-title">{b.title}</h2>
        <div className="bookcard-stats mono">
          <span>{b.chapters} {chapterWord(b.chapters)}</span>
          <span className="faint">·</span>
          <span>{b.words.toLocaleString("ru-RU")} слов</span>
        </div>
        {b.recommended && (
          <span
             className="bookcard-continue mono"
             role="link"
             onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.hash = `#/books/${b.id}/studio/${b.recommended === "concept" ? "" : b.recommended}`; }}>
            Продолжить →
          </span>
        )}
      </div>
      <div className="bookcard-foot">
        <span className="cap">{b.updated}</span>
        <span className="bookcard-foot-spacer" />
        {statusPill}
        <button className="bookcard-kebab" aria-label="Действия" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <I.More />
        </button>
      </div>
    </a>
  );
}

function chapterWord(n) {
  const r = n % 10, rr = n % 100;
  if (rr >= 11 && rr <= 14) return "глав";
  if (r === 1) return "глава";
  if (r >= 2 && r <= 4) return "главы";
  return "глав";
}

function BooksListPage() {
  const last = BOOKS[0];
  return (
    <div className="page page-books">
      <div className="page-head">
        <div>
          <h1>Ваши книги</h1>
          <p className="muted page-sub">{BOOKS.length} {chapterWord(BOOKS.length).replace(/глав\w*/, BOOKS.length === 1 ? "книга" : "книг")} · последняя правка {last.updated.toLowerCase()}</p>
        </div>
        <Button variant="primary" iconLeft={<I.Plus />}>Новая книга</Button>
      </div>

      <div className="bookgrid">
        {BOOKS.map((b) => <BookCard key={b.id} b={b} />)}
      </div>
    </div>
  );
}

window.LW = Object.assign(window.LW, { BooksListPage });

})();
