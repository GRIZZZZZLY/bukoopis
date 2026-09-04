(function(){
// app/pages/stages.jsx — Markdown / Entity / Chapters stages

const { BOOKS: BS, STAGES: ST2, ASPECTS, ENTITIES, CHAPTERS: CHL } = window.LW_DATA;
const { StageStepper: SS, Button: BST, Pill: PST, I: IST, Dot: DST, Card: CardST, Tabs: TabsST } = window.LW;

function stageMeta(id) {
  return {
    world:      { label: "Мир",       icon: "Globe", desc: "Климат, география, общество. Расширяемая карта, по которой писатель ориентируется." },
    lore:       { label: "Лор",       icon: "Stack", desc: "История, обычаи, вера. Что было до сцены и продолжает влиять." },
    plot:       { label: "Сюжет",     icon: "Map",   desc: "Каркас глав, развороты, кульминация. План, а не диктат." },
    characters: { label: "Персонажи", icon: "Users", desc: "Кандидаты на канон. Принимай, сливай или пропускай." },
    items:      { label: "Предметы",  icon: "Box",   desc: "Артефакты, реквизит, повторяющиеся объекты." },
  }[id];
}

/* ─── MarkdownStagePage ──────────────────────────────────── */

function PlaybookRunner({ stage }) {
  const meta = stageMeta(stage);
  return (
    <CardST paper>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div className="cap-upper">Этап</div>
          <h2 style={{ marginTop: 4 }}>{meta.label}</h2>
          <p className="muted" style={{ marginTop: 8, maxWidth: 560 }}>{meta.desc}</p>
        </div>
        <div className="field">
          <label className="field-label">Черновик (по желанию)</label>
          <textarea className="textarea" rows={4} placeholder="Опишите, что вы уже представляете. Можно одной фразой — модель развернёт." />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <BST variant="primary" iconLeft={<IST.Sparkles />}>Сгенерировать план аспектов</BST>
          <span className="cap mono faint">plot · sonnet · ~ 4–6 секунд</span>
        </div>
      </div>
    </CardST>
  );
}

function AspectRunner() {
  return (
    <div className="aspect-list">
      {ASPECTS.map((a) => (
        <article key={a.id} className={`aspect aspect-${a.status}`}>
          <div className="aspect-shimmer" aria-hidden="true" />
          <div className="aspect-head">
            <div className="aspect-title">{a.title}</div>
            <span className={`pill pill-${aspectTone(a.status)}`}>{aspectLabel(a.status)}</span>
          </div>
          {a.body && <div className="aspect-body">{a.body}</div>}
          {!a.body && a.status === "pending" && <div className="aspect-body faint">— ещё не сгенерирован —</div>}
          {a.body && (
            <div className="aspect-actions">
              <BST variant="primary" size="sm" iconLeft={<IST.Check />}>Принять</BST>
              <BST variant="ghost" size="sm">Доработать</BST>
              <BST variant="ghost" size="sm">Перегенерировать</BST>
              <BST variant="ghost" size="sm">Пропустить</BST>
            </div>
          )}
          {a.status === "pending" && (
            <div className="aspect-actions">
              <BST variant="primary" size="sm" iconLeft={<IST.Play />}>Сгенерировать</BST>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function aspectTone(s) { return { accepted:"green", reviewing:"brass", pending:"muted" }[s] || "muted"; }
function aspectLabel(s) { return { accepted:"принят", reviewing:"в обзоре", pending:"ждёт" }[s] || s; }

function MarkdownStagePage({ route }) {
  const book = BS.find((b) => b.id === route.bookId) || BS[0];
  const meta = stageMeta(route.stage);
  if (!meta) return <NotFound />;
  return (
    <div className="page page-stage">
      <SS bookId={book.id} stages={book.stages} activeStageId={route.stage} />
      <div className="page-head">
        <h1>{meta.label}</h1>
        <BST variant="ghost" size="sm" iconLeft={<IST.ArrowL />} as="a" href={`#/books/${book.id}/studio`}>К Studio</BST>
      </div>

      <PlaybookRunner stage={route.stage} />
      <AspectRunner />

      <div className="stage-foot">
        <div className="stage-foot-stat">
          <span className="cap-upper">Прогресс этапа</span>
          <span className="mono"><span className="strong">2</span><span className="faint">/5 аспектов приняты</span></span>
        </div>
        <BST variant="primary" iconRight={<IST.Check />}>Завершить стадию</BST>
      </div>
    </div>
  );
}

/* ─── EntityStagePage ────────────────────────────────────── */

function EntityStagePage({ route }) {
  const book = BS.find((b) => b.id === route.bookId) || BS[0];
  const isCharacters = route.stage === "characters";
  const list = isCharacters ? ENTITIES.characters : [];
  return (
    <div className="page page-stage">
      <SS bookId={book.id} stages={book.stages} activeStageId={route.stage} />
      <div className="page-head">
        <h1>{isCharacters ? "Персонажи" : "Предметы"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <BST variant="secondary" size="sm">Сгенерировать кандидатов</BST>
          <BST variant="ghost" size="sm" iconLeft={<IST.ArrowL />} as="a" href={`#/books/${book.id}/studio`}>К Studio</BST>
        </div>
      </div>

      <div className="entity-grid">
        {list.map((e) => (
          <article key={e.id} className={`entity entity-${e.status}`}>
            <div className="entity-icon" aria-hidden="true">
              {isCharacters ? <IST.Users /> : <IST.Box />}
            </div>
            <div className="entity-body">
              <div className="entity-head">
                <div className="entity-name">{e.name}</div>
                {e.status === "materialized"
                  ? <PST tone="green" icon={<IST.Check />}>в каноне</PST>
                  : <PST tone="amber">кандидат</PST>}
                <span className="entity-id mono faint">{e.id}</span>
              </div>
              <div className="entity-role muted">{e.role}</div>
              <ul className="entity-traits">
                {e.traits.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
              <div className="entity-actions">
                {e.status === "candidate" ? (
                  <>
                    <BST variant="primary" size="sm" iconLeft={<IST.Check />}>Принять</BST>
                    <BST variant="ghost" size="sm">Слить</BST>
                    <BST variant="ghost" size="sm">Отклонить</BST>
                  </>
                ) : (
                  <>
                    <BST variant="ghost" size="sm" iconLeft={<IST.Edit />}>Редактировать</BST>
                    <BST variant="ghost" size="sm">Перегенерировать профиль</BST>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ─── ChaptersStagePage ──────────────────────────────────── */

function ChaptersStagePage({ route }) {
  const book = BS.find((b) => b.id === route.bookId) || BS[0];
  return (
    <div className="page page-stage">
      <SS bookId={book.id} stages={book.stages} activeStageId="chapters" />
      <div className="page-head">
        <h1>Главы</h1>
        <BST variant="ghost" size="sm" iconLeft={<IST.ArrowL />} as="a" href={`#/books/${book.id}/studio`}>К Studio</BST>
      </div>

      <CardST paper className="panel-outline">
        <div className="panel-head">
          <h3>План книги</h3>
          <span className="cap mono faint">3 акта · 7 поворотов</span>
        </div>
        <ol className="outline-acts">
          <li><span className="mono">I.</span> Возвращение Лины в Дом · экспозиция, странные звуки, отказ верить.</li>
          <li><span className="mono">II.</span> Доверие. Андрей рассказывает легенду Заливщины. Первая встреча с «слышащим».</li>
          <li><span className="mono">III.</span> Выбор. Лина зажигает свечу. Дом раскрывается полностью.</li>
        </ol>
      </CardST>

      <div className="panel-row">
        <CardST className="panel">
          <div className="panel-head">
            <h3>Канон</h3>
            <div style={{ display: "flex", gap: 6 }}>
              <PST>персонажи · 4</PST>
              <PST>предметы · 3</PST>
              <PST>места · 8</PST>
            </div>
          </div>
          <div className="canon-list">
            {[
              { s: "Лина", p: "слышит", o: "соседский смех (гл. 1, 4)" },
              { s: "Дом", p: "имеет", o: "канделябр у северной стены" },
              { s: "Лина", p: "наследует", o: "Дом от бабушки" },
              { s: "Залив", p: "расположен", o: "в 7 км от Дома" },
            ].map((f, i) => (
              <div key={i} className="canon-row">
                <span className="strong">{f.s}</span>
                <span className="muted">{f.p}</span>
                <span>{f.o}</span>
              </div>
            ))}
          </div>
        </CardST>

        <CardST className="panel">
          <div className="panel-head">
            <h3>Импорт / Экспорт</h3>
          </div>
          <div className="iox">
            <div className="iox-zone">
              <IST.Plus />
              <span className="cap">Перетащите файл</span>
              <span className="mono faint">txt · md · docx · fb2</span>
            </div>
            <div className="iox-export">
              <div className="cap-upper">Экспорт</div>
              <div className="iox-radios">
                <label><input type="radio" name="fmt" defaultChecked /> docx</label>
                <label><input type="radio" name="fmt" /> md</label>
                <label><input type="radio" name="fmt" /> fb2</label>
              </div>
              <div className="iox-checks">
                <label><input type="checkbox" /> с разбором критика</label>
                <label><input type="checkbox" defaultChecked /> с каноном</label>
                <label><input type="checkbox" /> с планом</label>
              </div>
              <BST variant="primary" size="sm">Экспортировать</BST>
            </div>
          </div>
        </CardST>
      </div>

      <CardST className="panel">
        <div className="panel-head">
          <h3>Поиск по корпусу</h3>
          <span className="cap mono faint">эмбеддинги + лексика</span>
        </div>
        <div className="search-panel">
          <div className="search-field">
            <IST.Search />
            <input className="input" placeholder="«канделябр» или семантический запрос" defaultValue="канделябр у северной стены" />
          </div>
          <div className="search-chips">
            {["все главы", "только драфт", "с правками критика", "канон"].map((c, i) => (
              <PST key={c} tone={i === 0 ? "brass" : "muted"}>{c}</PST>
            ))}
          </div>
          <div className="search-results">
            {[
              { ch: 4, title: "Канделябр у северной стены", excerpt: "Канделябр у северной стены давно не зажигали. Шесть свечей…", rel: 0.92 },
              { ch: 2, title: "Дочери залива",            excerpt: "…бронзовый канделябр на столе у окна. Лина не помнила…",     rel: 0.71 },
              { ch: 7, title: "Три ступени вниз",          excerpt: "…под канделябром лежало письмо, и она боялась его развернуть.", rel: 0.66 },
            ].map((r) => (
              <a key={r.ch} className="search-result" href={`#/books/${book.id}/chapters/${r.ch}`}>
                <span className="mono faint">гл. {r.ch}</span>
                <span className="search-title strong">{r.title}</span>
                <span className="search-excerpt muted">{r.excerpt}</span>
                <span className="mono search-rel">{r.rel.toFixed(2)}</span>
              </a>
            ))}
          </div>
        </div>
      </CardST>

      <CardST className="panel">
        <div className="panel-head">
          <h3>Список глав</h3>
          <BST variant="ghost" size="sm" iconLeft={<IST.Plus />}>Новая глава</BST>
        </div>
        <ol className="chrack">
          {CHL.map((c) => (
            <li key={c.id} className="chrack-row">
              <a href={`#/books/${book.id}/chapters/${c.id}`}>
                <span className="chrack-grip" aria-hidden="true"><IST.Grip /></span>
                <span className="chrack-num mono">#{String(c.order).padStart(2, "0")}</span>
                <span className="chrack-title">{c.title}</span>
                <span className="chrack-stat">{statusPillForChapter(c.status)}</span>
                <span className="chrack-words mono faint">{c.words ? `${c.words.toLocaleString("ru-RU")} сл.` : "—"}</span>
                <span className="chrack-actions" aria-hidden="true"><IST.ArrowR /></span>
              </a>
            </li>
          ))}
        </ol>
      </CardST>
    </div>
  );
}

function statusPillForChapter(s) {
  if (s === "complete") return <PST tone="green">завершено</PST>;
  if (s === "revising") return <PST tone="amber">в правке</PST>;
  if (s === "draft")    return <PST tone="blue">черновик</PST>;
  return <PST>план</PST>;
}

function NotFound() {
  return (
    <div className="page page-404">
      <div className="nf">
        <div className="nf-mark" aria-hidden="true">
          <svg viewBox="0 0 64 80" width="56" height="70" fill="none" stroke="var(--color-brass)" strokeWidth="1.6">
            <rect x="6" y="6" width="52" height="68" rx="3" />
            <path d="M32 6v56l-8-6-8 6V6" />
          </svg>
        </div>
        <h1>Страница потерялась</h1>
        <p className="muted">Возможно, её перенесли в другую главу.</p>
        <a href="#/books" className="btn btn-primary btn-md">На главную</a>
      </div>
    </div>
  );
}

window.LW = Object.assign(window.LW, {
  MarkdownStagePage, EntityStagePage, ChaptersStagePage, NotFound,
});

})();
