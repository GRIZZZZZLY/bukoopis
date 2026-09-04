/* global React, Icon, I, Button, IconBtn, Pill, Card, Skel, useRoute, useToast, STAGES */
const { useState } = React;

// ───────────────────────────────────────────────
// Mock data
// ───────────────────────────────────────────────
const BOOKS = [
  { id: 1, title: "Тёмные тропы Бельведера", genre: "Тёмное фэнтези", audience: "18+", chapters: 12, words: 48230, updated: "2 ч. назад", status: "активна", recommended: "chapters", spine: "#D49A4E" },
  { id: 2, title: "Молочный туман",          genre: "Магический реализм", audience: "16+", chapters: 4,  words: 11820, updated: "вчера",     status: "черновик", recommended: "lore", spine: "#B5803A" },
  { id: 3, title: "Песнь о Стеклянном Доме", genre: "Научная фантастика", audience: "18+", chapters: 8,  words: 31460, updated: "3 дня",     status: "активна", recommended: "characters", spine: "#E8B361" },
  { id: 4, title: "Хроники Подзёмки",        genre: "Городское фэнтези",  audience: "16+", chapters: 0,  words: 0,     updated: "неделю",    status: "черновик", recommended: "concept", spine: "#C89243" },
  { id: 5, title: "Между двух светил",       genre: "Драма",              audience: "18+", chapters: 15, words: 58910, updated: "месяц",     status: "архив",    recommended: null, spine: "#8E6126" },
  { id: 6, title: "Записки из жёлтой тетради", genre: "Литературная проза", audience: "18+", chapters: 6, words: 19340, updated: "5 дней",   status: "активна", recommended: "plot", spine: "#D49A4E" },
];

const STAGE_LABEL = {
  concept: "Концепт", world: "Мир", lore: "Лор",
  characters: "Персонажи", items: "Предметы",
  plot: "Сюжет", chapters: "Главы",
};

// ───────────────────────────────────────────────
// BooksListPage
// ───────────────────────────────────────────────
const BooksListPage = () => {
  const { navigate } = useRoute();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  const handleCreate = () => {
    if (!title.trim()) return;
    toast("Книга создана", { tone: "success" });
    navigate("/books/1/studio");
  };

  return (
    <div className="route" data-screen-label="Books list">
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 32px 96px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 32 }}>
          <div>
            <h1 className="font-display" style={{ fontSize: 36, fontWeight: 500, margin: "0 0 8px", letterSpacing: "-0.015em", color: "var(--color-text-strong)" }}>
              Ваши книги
            </h1>
            <div className="text-muted" style={{ fontSize: 14 }}>
              6 книг · последняя правка <span className="font-mono" style={{ color: "var(--color-text)" }}>2 ч. назад</span>
            </div>
          </div>
          {!creating ? (
            <Button variant="primary" icon={I.plus} onClick={() => setCreating(true)}>
              Новая книга
            </Button>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="input" autoFocus
                     placeholder="Название книги…"
                     value={title}
                     onChange={e => setTitle(e.target.value)}
                     onKeyDown={e => e.key === "Enter" && handleCreate()}
                     style={{ width: 280 }}/>
              <Button variant="primary" onClick={handleCreate}>Создать</Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setTitle(""); }}>Отмена</Button>
            </div>
          )}
        </div>

        {/* Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 20,
        }}>
          {BOOKS.map(b => <BookCard key={b.id} book={b} onOpen={() => navigate(`/books/${b.id}/studio`)}/>)}
        </div>

        {/* Footer hint */}
        <div style={{ marginTop: 48, color: "var(--color-text-faint)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          Нажмите <span className="kbd" style={{ verticalAlign: "middle" }}>N</span> чтобы создать новую книгу
        </div>
      </div>
    </div>
  );
};

const BookCard = ({ book, onOpen }) => {
  const statusTone = book.status === "активна" ? "blue" : book.status === "черновик" ? "amber" : "muted";
  return (
    <div className="card hoverable" onClick={onOpen} style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: 220 }}>
      {/* Faux spine */}
      <div className="spine" style={{ height: 12, background: `linear-gradient(180deg, ${book.spine}99, ${book.spine}, ${book.spine}99)` }}>
        <div className="font-mono" style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          padding: "0 12px", fontSize: 8, color: "rgba(26,20,16,0.55)",
          letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 600,
        }}>
          BKO · {String(book.id).padStart(4, "0")}
        </div>
      </div>
      {/* Paper body */}
      <div className="paper" style={{ flex: 1, padding: "20px 22px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <h3 className="font-display" style={{
            fontSize: 22, fontWeight: 500, margin: 0, lineHeight: 1.15,
            color: "var(--color-text-strong)", letterSpacing: "-0.01em",
            textWrap: "pretty",
          }}>
            {book.title}
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()} style={{ width: 28, height: 28, padding: 0, flexShrink: 0 }} aria-label="Меню">
            <Icon d={I.more} size={14}/>
          </button>
        </div>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          {book.genre} · {book.audience}
        </div>
        <div className="font-mono" style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 10, display: "flex", gap: 16 }}>
          <span><span style={{ color: "var(--color-text-muted)" }}>{book.chapters}</span> глав</span>
          <span><span style={{ color: "var(--color-text-muted)" }}>{book.words.toLocaleString("ru-RU")}</span> слов</span>
        </div>
        {book.recommended && (
          <div className="font-mono" style={{ fontSize: 11, marginTop: 8 }}>
            <span style={{ color: "var(--color-text-faint)" }}>далее: </span>
            <a href="#" onClick={e => e.preventDefault()} style={{ borderBottom: "1px solid currentColor" }}>
              {STAGE_LABEL[book.recommended]} →
            </a>
          </div>
        )}
        <div style={{ flex: 1 }}/>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <span className="font-mono" style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{book.updated}</span>
          <Pill tone={statusTone} dot>{book.status}</Pill>
        </div>
      </div>
    </div>
  );
};

window.BooksListPage = BooksListPage;
window.MOCK_BOOKS = BOOKS;
window.STAGE_LABEL = STAGE_LABEL;
