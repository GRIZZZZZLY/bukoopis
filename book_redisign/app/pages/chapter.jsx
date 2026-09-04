(function(){
// app/pages/chapter.jsx — ChapterPage (manuscript + critique rail + diff overlay)

const { CHAPTERS: CHS, CHAPTER_BODY: CBODY, CRITIQUE } = window.LW_DATA;
const { cn: cnC, Button: BC, Pill: PC, I: IC, Dot: DC, Tabs, Kbd, Card: CardC } = window.LW;

function OutlineRail({ active, onJump, collapsed }) {
  if (collapsed) return null;
  const maxWords = Math.max(...CHS.map((c) => c.words || 100));
  return (
    <aside className="outline-rail">
      <div className="outline-head">
        <span className="cap-upper">Главы</span>
        <span className="mono faint">{CHS.length}</span>
      </div>
      <ol className="outline-list">
        {CHS.map((c) => (
          <li key={c.id} className={cnC("outline-item", c.id === active && "outline-item-active")}>
            <a href={`#/books/1/chapters/${c.id}`}>
              <span className="outline-bar" aria-hidden="true" />
              <span className="outline-num mono">#{String(c.order).padStart(2, "0")}</span>
              <span className="outline-title">{c.title}</span>
              <span className="outline-wc">
                <span className="outline-wc-bar"><span style={{ width: `${(c.words/maxWords)*100}%` }} /></span>
                <span className="mono faint">{Math.round((c.words||0)/1000)}k</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
      <div className="outline-foot">
        <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }}>
          <IC.Plus /> Новая глава
        </button>
        <div className="outline-jump-hint mono faint">
          <Kbd>⌘P</Kbd> переход к главе
        </div>
      </div>
    </aside>
  );
}

function InlineCommandPanel() {
  return (
    <div className="inline-cmd">
      <span className="inline-cmd-caret" aria-hidden="true">↳</span>
      <span className="cap-upper">Выделено · 18 слов</span>
      <span className="sep">·</span>
      <button className="inline-cmd-btn">Переписать</button>
      <button className="inline-cmd-btn">Сократить</button>
      <button className="inline-cmd-btn">Развернуть</button>
      <button className="inline-cmd-btn">Перевести</button>
      <button className="inline-cmd-btn inline-cmd-more"><IC.Sparkles /> Своя инструкция</button>
    </div>
  );
}

function Manuscript({ streaming }) {
  return (
    <div className="ms-wrap">
      <div className="ms-paper paper-grain">
        <div className="ms-margin" aria-hidden="true" />

        <div className="ms-head">
          <div className="ms-chapter-label">Глава {CBODY.chapter}</div>
          <h1 className="ms-title" contentEditable suppressContentEditableWarning>{CBODY.title}</h1>
        </div>

        <article className="ms-body">
          <p className="ms-first">
            <span className="dropcap">{CBODY.paragraphs[0][0]}</span>
            {CBODY.paragraphs[0].slice(1)}
          </p>
          {CBODY.paragraphs.slice(1, 2).map((p, i) => <p key={`pre-${i}`}>{p}</p>)}

          {/* paragraph 3 — has a canon issue */}
          <p>
            — Не надо, — сказала она вслух, и собственный голос показался ей чужим. — Не надо, не надо.
          </p>

          {/* paragraph 4 — contains the red-ink canon revision inline */}
          <p>
            За дверью пахло солью и сухими розами, и этот запах не оставлял дом никогда — даже летом, даже когда море пряталось за{" "}
            <span className="diff-del" data-comment-anchor="c3"><s>двадцатью</s></span>
            <span className="diff-add"> семью </span>
            километрами полей. Лина опустила руку и долго смотрела на свечи, как смотрят на детей, которых ещё не научили говорить.
          </p>

          <p>
            Через стену кто-то засмеялся коротким, скомканным смехом — так смеются, когда уже не помнят, чему именно. Лина прислушалась, но больше ничего не последовало. Только шорох плюща и тонкий, чуть металлический шум — как если бы кто-то медленно перекладывал в кармане ключи.
          </p>

          {/* AI streaming tail */}
          {streaming && (
            <p className="ms-streamed">
              {CBODY.streamingTail}
              <span className="ms-caret" aria-hidden="true">_</span>
            </p>
          )}
        </article>

        <div className="ms-footer mono faint">
          <span>4 210 слов · 28 690 знаков · 5 120 ток.</span>
          <span className="sep">·</span>
          <span>сохранено · только что</span>
        </div>
      </div>
    </div>
  );
}

function VerdictDots({ verdicts }) {
  const items = [
    { id: "logic", label: "Логика" },
    { id: "prose", label: "Проза" },
    { id: "canon", label: "Канон" },
  ];
  const tone = (v) => v === "good" ? "green" : v === "warn" ? "amber" : "red";
  return (
    <div className="verdict-dots">
      {items.map((it) => (
        <span key={it.id} className="verdict-dot">
          <DC tone={tone(verdicts[it.id])} size={8} />
          <span className="cap">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function CritiqueCard({ c, index }) {
  const sevTone = c.severity === "red" ? "red" : c.severity === "amber" ? "amber" : "blue";
  return (
    <article className="cri-card" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="cri-card-top">
        <DC tone={sevTone} size={7} />
        <span className="cri-card-title">{c.title}</span>
        <span className="cri-card-agent pill pill-mono">{c.agent}</span>
      </div>
      <blockquote className="cri-card-excerpt">«{c.excerpt}»</blockquote>
      <p className="cri-card-body">{c.body}</p>
      {c.suggestion && (
        <div className="cri-card-sugg">
          <span className="cap-upper">правка</span>
          <code>{c.suggestion}</code>
        </div>
      )}
      <div className="cri-card-actions">
        <button className="cri-link">Применить правку</button>
        <button className="cri-link cri-link-ghost">Игнорировать</button>
        <button className="cri-link cri-link-ghost">Создать задачу</button>
        <span className="cri-card-jump"><a className="mono" href="#go">Перейти ↗</a></span>
      </div>
    </article>
  );
}

function CritiqueRail({ collapsed }) {
  const [tab, setTab] = React.useState("Все");
  const tabs = ["Все", "Сюжет", "Стиль", "Канон", "Факты"];
  if (collapsed) return null;
  const visible = tab === "Все" ? CRITIQUE.issues : CRITIQUE.issues.filter((c) => c.tab === tab);
  return (
    <aside className="cri-rail">
      <div className="cri-head">
        <div className="cri-head-top">
          <span className="cri-head-label">Разбор главы</span>
          <span className="mono faint">writer + critique · 32 сек назад</span>
        </div>
        <VerdictDots verdicts={CRITIQUE.verdicts} />
      </div>

      <div className="cri-tabs">
        <Tabs value={tab} onChange={setTab} options={tabs.map((t) => ({
          id: t, label: t,
          count: t === "Все" ? CRITIQUE.issues.length : CRITIQUE.issues.filter((c) => c.tab === t).length,
        }))} />
      </div>

      <div className="cri-list">
        {visible.map((c, i) => <CritiqueCard key={c.id} c={c} index={i} />)}
      </div>

      <div className="cri-foot">
        <BC variant="primary" size="sm" iconLeft={<IC.Refresh />}>Запросить новый разбор</BC>
        <select className="select cri-foot-sel" defaultValue="critique">
          <option value="critique">критик · полный</option>
          <option value="canon_fact_extractor">только канон</option>
          <option value="style_extractor">только стиль</option>
        </select>
      </div>
    </aside>
  );
}

function ChapterPage({ route, focusMode, leftCollapsed, rightCollapsed, onToggleRight }) {
  return (
    <div className="page page-chapter">
      <div className="chapter-toolbar">
        <a href="#/books/1/studio/chapters" className="cap mono back-link">← К главам</a>
        <span className="sep">·</span>
        <PC tone="amber" icon={<DC tone="amber" size={6} />}>В правке</PC>
        <span className="sep">·</span>
        <PC tone="mono" className="pill-mono">writer · sonnet</PC>
        <span className="ch-toolbar-spacer" />
        <BC variant="ghost" size="sm" iconLeft={<IC.Sparkles />}>Попросить продолжить</BC>
        <BC variant="ghost" size="sm">
          Версии <span className="mono faint">· 7</span>
        </BC>
        <BC variant="secondary" size="sm" onClick={onToggleRight}>
          {rightCollapsed ? "Показать разбор" : "Скрыть разбор"} <Kbd>⌘/</Kbd>
        </BC>
      </div>

      <div className="diff-toolbar">
        <span className="cap-upper diff-toolbar-label">Активные правки</span>
        <span className="mono diff-stat diff-stat-add">+1 добавление</span>
        <span className="mono diff-stat diff-stat-del">−1 удаление</span>
        <span className="ch-toolbar-spacer" />
        <BC variant="primary" size="sm">Принять всё</BC>
        <BC variant="ghost" size="sm">Принять выбранное</BC>
        <BC variant="ghost" size="sm">Отклонить всё</BC>
      </div>

      <div className={cnC("chapter-grid", leftCollapsed && "chapter-grid-noleft", rightCollapsed && "chapter-grid-noright")}>
        <OutlineRail active={4} collapsed={leftCollapsed} />
        <main className="chapter-main">
          <Manuscript streaming={false} />
          <InlineCommandPanel />
        </main>
        <CritiqueRail collapsed={rightCollapsed} />
      </div>
    </div>
  );
}

window.LW = Object.assign(window.LW, { ChapterPage });

})();
