// ChapterPage — the highest-leverage screen, shown most prominently.
// 3-column: OutlineRail | Manuscript (paper) | CritiqueRail.
// Includes Tweaks: aiSurface (pill/bottombar/gutter), serif (lora/sourceserif/fraunces), grain (off/subtle/strong)

const { useState: useStateChp } = React;

// Public-domain Russian classic excerpt — Bulgakov, "Мастер и Маргарита" (1940), public domain in source country.
// Light remix to fit the demo as if it's the user's draft.
const DEMO_PARAGRAPHS = [
  "Однажды весною, в час небывало жаркого заката, в Москве, на Патриарших прудах, появились двое граждан. Первый из них, одетый в летнюю серенькую пару, был маленького роста, упитан, лыс, свою приличную шляпу пирожком нёс в руке, а на хорошо выбритом лице его помещались сверхъестественных размеров очки в чёрной роговой оправе.",
  "Второй — плечистый, рыжеватый, вихрастый молодой человек в заломленной на затылок клетчатой кепке — был в ковбойке, жёваных белых брюках и в чёрных тапочках. Они шли молча, и каждый из них думал о своём; и если бы кто-нибудь со стороны попытался прочесть их мысли, то с удивлением обнаружил бы, что обоих занимает один и тот же неназванный предмет.",
  "Когда они проходили мимо третьей скамейки, пыльная аллея сама собой стихла. Лишь где-то далеко, за прудом, прокричала чайка — и снова молчание, такое плотное, что казалось, его можно было трогать рукой. Берлиоз остановился и повернул голову к спутнику с тем медленным и осторожным движением, каким человек поворачивается в темноте, услышав за спиной шаги.",
  "— Иван Николаевич, — начал он, глядя куда-то поверх скамеек, — вы серьёзно полагаете, что в этом городе сегодня ничего не произошло? Что воздух не сделался иной, что лица прохожих не сделались иными? Я не говорю о ваших стихах. Я говорю о другом, о большем. Воздух пахнет грозою, которой ещё нет.",
];

const CritiqueCard = ({ tone = "amber", agent, title, body, line, onScroll }) => (
  <div className="lw-card" style={{ padding: 14, position: "relative" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <Dot tone={tone} />
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", flex: 1 }}>{title}</div>
      <span className="lw-pill" data-tone="brass" style={{ height: 18, fontSize: 10 }}>{agent}</span>
    </div>
    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 10 }}>{body}</div>
    {line && (
      <div style={{
        fontFamily: "var(--font-prose)", fontStyle: "italic", fontSize: 12,
        color: "var(--text-faint)", padding: "6px 10px", borderLeft: "2px solid var(--border-strong)",
        marginBottom: 10
      }}>« {line} »</div>
    )}
    <div style={{ display: "flex", gap: 6 }}>
      <button className="lw-btn" data-variant="primary" data-size="sm">Применить</button>
      <button className="lw-btn" data-variant="ghost" data-size="sm">Игнорировать</button>
      <button className="lw-btn" data-variant="link" data-size="sm" onClick={onScroll} style={{ marginLeft: "auto" }}>Перейти →</button>
    </div>
  </div>
);

const OutlineRail = () => {
  const chapters = [
    { n: 1, title: "Перед грозой", words: 3120, status: "готова" },
    { n: 2, title: "Незваный гость", words: 4580, status: "готова" },
    { n: 3, title: "На Патриарших", words: 5210, status: "готова" },
    { n: 4, title: "Разговор о невозможном", words: 2840, status: "редактируется", active: true },
    { n: 5, title: "Воланд", words: 0, status: "черновик" },
    { n: 6, title: "Берлиоз и трамвай", words: 0, status: "черновик" },
  ];
  return (
    <div style={{ width: 240, borderRight: "1px solid var(--border-soft)", background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <div className="lw-meta" style={{ marginBottom: 8 }}>Главы</div>
        <div style={{ position: "relative" }}>
          <input className="lw-input" placeholder="Поиск по плану…" style={{ paddingLeft: 28, height: 28, fontSize: 12 }} />
          <span style={{ position: "absolute", left: 8, top: 6, color: "var(--text-faint)" }}><Icon name="search" size={14} /></span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        {chapters.map(c => (
          <div key={c.n} style={{
            position: "relative", padding: "8px 10px", marginBottom: 2,
            borderRadius: 6, cursor: "pointer",
            background: c.active ? "var(--surface-2)" : "transparent",
          }}>
            {c.active && <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, background: "var(--brass)", borderRadius: 2 }} />}
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-faint)" }}>{String(c.n).padStart(2,"0")}</span>
              <span style={{ fontSize: 13, color: c.active ? "var(--text-strong)" : "var(--text)", fontWeight: c.active ? 500 : 400 }}>{c.title}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <div style={{ flex: 1, height: 2, background: "var(--surface-2)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, c.words/60)}%`, height: "100%", background: c.status === "готова" ? "var(--ink-green)" : c.status === "редактируется" ? "var(--brass)" : "var(--text-faint)" }} />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)" }}>{c.words || "—"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: 10, borderTop: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 6 }}>
        <Btn variant="ghost" size="sm" icon="search" style={{ width: "100%", justifyContent: "flex-start" }}>
          К главе… <span style={{ marginLeft: "auto" }}><Kbd>⌘P</Kbd></span>
        </Btn>
      </div>
    </div>
  );
};

const Manuscript = ({ aiSurface, serif, showDiff = false }) => {
  const fontFamily = serif === "sourceserif" ? "'Source Serif 4', Georgia, serif"
    : serif === "fraunces" ? "'Fraunces', Georgia, serif"
    : "'Lora', Georgia, serif";

  return (
    <div style={{ flex: 1, position: "relative", overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div className="lw-paper" style={{ flex: 1, padding: "48px 32px 80px", position: "relative" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", position: "relative", paddingLeft: 24 }}>
          <div className="lw-margin-rule" style={{ left: 0 }} />

          <div style={{ marginBottom: 32 }}>
            <div className="lw-italic-muted" style={{ fontSize: 13, marginBottom: 8 }}>Глава 4</div>
            <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 36, lineHeight: 1.15, margin: 0, color: "var(--text-strong)" }}>
              Разговор о невозможном
            </h1>
          </div>

          <div className="lw-prose" style={{ fontFamily, position: "relative" }}>
            <p>{DEMO_PARAGRAPHS[0]}</p>
            <p style={{ position: "relative" }}>
              <span className="lw-gutter-dot" style={{ background: "var(--ink-amber)" }} title="Замечание стиля" />
              {DEMO_PARAGRAPHS[1]}
            </p>
            {showDiff ? (
              <p style={{ position: "relative" }}>
                <span className="lw-gutter-dot" style={{ background: "var(--ink-red)" }} />
                Когда они проходили мимо третьей скамейки, <span className="lw-del">пыльная аллея сама собой стихла.</span>
                <span className="lw-add"> воздух будто загустел, и пыль на аллее замерла, словно в ожидании.</span>
                {" "}Лишь где-то далеко, за прудом, прокричала чайка — и снова молчание, такое плотное, что казалось, его можно было <span className="lw-del">трогать</span><span className="lw-add">осязать</span> рукой. Берлиоз остановился и повернул голову к спутнику с тем медленным и осторожным движением, каким человек поворачивается в темноте, услышав за спиной шаги.
              </p>
            ) : (
              <p>{DEMO_PARAGRAPHS[2]}</p>
            )}
            <p>
              {DEMO_PARAGRAPHS[3]}
              <span className="lw-caret" />
            </p>
          </div>

          {/* word counter */}
          <div style={{
            position: "absolute", left: 0, bottom: -56,
            fontFamily: "var(--font-mono)", fontSize: 11,
            color: "var(--text-faint)",
            display: "flex", gap: 14
          }}>
            <span>2 840 слов</span>
            <span>16 942 знака</span>
            <span>≈ 11 мин чтения</span>
          </div>
        </div>

        {/* AI surface variants */}
        {aiSurface === "pill" && (
          <div style={{
            position: "absolute", left: "50%", top: 280,
            transform: "translateX(-50%)",
            background: "var(--surface-2)", border: "1px solid var(--brass-soft)",
            borderRadius: 999, padding: "6px 14px",
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: "var(--shadow-md)",
            color: "var(--text-strong)", fontSize: 12,
          }}>
            <Icon name="sparkle" size={13} style={{ color: "var(--brass)" }} />
            Что сделать?
            <Kbd>⌘↵</Kbd>
          </div>
        )}

        {aiSurface === "gutter" && (
          <div style={{
            position: "absolute", left: 32, top: 380,
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            {["Переписать", "Сократить", "Развернуть"].map(a => (
              <button key={a} className="lw-btn" data-variant="ghost" data-size="sm" style={{
                justifyContent: "flex-start", width: 130,
                background: "var(--surface-2)", border: "1px solid var(--border-soft)"
              }}>
                <Icon name="sparkle" size={12} style={{ color: "var(--brass)" }} />
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI surface: bottom command bar */}
      {aiSurface === "bottombar" && (
        <div style={{
          padding: "10px 16px",
          background: "var(--surface-1)",
          borderTop: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <Icon name="sparkle" size={16} style={{ color: "var(--brass)" }} />
          <input className="lw-input" placeholder="Скажи модели, что сделать с выделением…" style={{ flex: 1, height: 32, background: "var(--surface-2)" }} />
          <Pill icon="feather">writer</Pill>
          <Btn variant="primary" size="sm" iconRight="arrow">Запустить</Btn>
          <Kbd>⌘↵</Kbd>
        </div>
      )}
    </div>
  );
};

const CritiqueRail = () => {
  const cards = [
    { tone: "red", agent: "canon_check", title: "Несоответствие канону", body: "Берлиоз в гл. 2 уже упоминается как «маленького роста, упитан, лыс». Описание в гл. 4 повторяет канон без развития — рискует звучать как штамп.", line: "маленького роста, упитан, лыс" },
    { tone: "amber", agent: "style_extractor", title: "Сбой ритма", body: "Длинное сложноподчинённое во втором абзаце (44 слова) после двух предыдущих коротких — подумать о разрыве на два предложения.", line: "если бы кто-нибудь со стороны попытался прочесть их мысли…" },
    { tone: "amber", agent: "critic_prose", title: "Тавтология", body: "«молчание, такое плотное, что его можно было трогать» — рассмотреть «осязать» вместо «трогать».", line: "его можно было трогать рукой" },
    { tone: "blue", agent: "summarizer", title: "Заметка", body: "Первое появление мотива грозы — стоит проверить, поддержан ли он в гл. 5 как обещание.", line: "Воздух пахнет грозою, которой ещё нет" },
    { tone: "green", agent: "writer", title: "Хорошая находка", body: "Метафора «молчание, которое можно было трогать рукой» — оставить, даже если переписывать абзац: образ держит сцену." },
  ];
  return (
    <div style={{ width: 380, background: "var(--bg)", borderLeft: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div className="lw-meta" style={{ flex: 1 }}>Разбор главы</div>
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
            <Dot tone="amber" /> сюжет
          </span>
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
            <Dot tone="amber" /> стиль
          </span>
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
            <Dot tone="red" /> канон
          </span>
        </div>
        <div className="lw-tabs" style={{ borderBottom: "none" }}>
          {["Все","Сюжет","Стиль","Канон","Факты"].map((t,i) => (
            <button key={t} className="lw-tab" data-active={i===0} style={{ padding: "6px 10px", fontSize: 12 }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {cards.map((c, i) => <CritiqueCard key={i} {...c} />)}
      </div>
      <div style={{ padding: 12, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 8 }}>
        <Btn variant="primary" icon="sparkle" style={{ flex: 1 }}>Запросить новый разбор</Btn>
        <Btn variant="secondary" icon="chev" />
      </div>
    </div>
  );
};

const ChapterPage = ({ aiSurface = "pill", serif = "lora", grain = "subtle", showDiff = false }) => {
  // grain handled by parent setting --grain-opacity on the artboard
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar
        crumbs={[{ label: "Книги" }, { label: "Стальные ливни" }, { label: "Глава 4", bold: true }]}
        center={
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="lw-italic-muted" style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>Гл. 4 ·</span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--text-strong)", fontWeight: 500 }}>Разговор о невозможном</span>
          </div>
        }
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <LeftRail active="current" />
        <OutlineRail />
        <Manuscript aiSurface={aiSurface} serif={serif} showDiff={showDiff} />
        <CritiqueRail />
      </div>
      <StatusBar
        tokens="12 480"
        agent="writer"
        backend="api"
        cost="$0.18"
        extra={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span>стрим</span>
            <div style={{ width: 80 }}><div className="lw-progress"><i style={{ width: "62%" }} /></div></div>
            <Mono>3 100 / 5 000</Mono>
          </span>
        }
      />
    </div>
  );
};

window.ChapterPage = ChapterPage;
