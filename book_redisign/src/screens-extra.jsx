// Extra screens: CommandPalette, Search, FocusMode, Toolkit (primitives showcase)

const CommandPalette = () => (
  <div style={{ position: "absolute", inset: 0, background: "var(--overlay)", backdropFilter: "blur(16px)", display: "grid", placeItems: "start center", paddingTop: 120 }}>
    <div style={{
      width: 560, background: "var(--surface-1)",
      border: "1px solid var(--border)", borderRadius: 14,
      boxShadow: "var(--shadow-lg)", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border-soft)", gap: 10 }}>
        <Icon name="search" size={18} style={{ color: "var(--brass)" }} />
        <input className="lw-input" defaultValue="перепис" autoFocus style={{ background: "transparent", border: 0, padding: 0, fontSize: 15, height: 24 }} />
        <Kbd>Esc</Kbd>
      </div>
      <div style={{ padding: 6, maxHeight: 360, overflow: "auto" }}>
        <div className="lw-meta" style={{ padding: "8px 12px", color: "var(--text-faint)" }}>Действия</div>
        {[
          { icon: "sparkle", t: "Переписать выделение", k: "⌘↵", active: true },
          { icon: "sparkle", t: "Переписать в стиле «Тёплый рассказчик»" },
          { icon: "feather", t: "Перейти к разбору главы", k: "⌘/" },
        ].map((it, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8,
            background: it.active ? "var(--surface-3)" : "transparent",
            ...(it.active && { boxShadow: "inset 2px 0 0 var(--brass)" }),
            cursor: "pointer",
          }}>
            <Icon name={it.icon} size={14} style={{ color: it.active ? "var(--brass)" : "var(--text-muted)" }} />
            <span style={{ flex: 1, fontSize: 13, color: it.active ? "var(--text-strong)" : "var(--text)" }}>{it.t}</span>
            {it.k && <Kbd>{it.k}</Kbd>}
          </div>
        ))}
        <div className="lw-meta" style={{ padding: "12px 12px 8px", color: "var(--text-faint)" }}>Главы</div>
        {[
          { t: "Гл. 4 · Разговор о невозможном" },
          { t: "Гл. 3 · На Патриарших" },
          { t: "Гл. 5 · Воланд" },
        ].map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8 }}>
            <Icon name="book" size={14} style={{ color: "var(--text-muted)" }} />
            <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{it.t}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderTop: "1px solid var(--border-soft)", background: "var(--bg)", color: "var(--text-faint)", fontSize: 11 }}>
        <Kbd>↑↓</Kbd> навигация
        <Kbd>↵</Kbd> выбрать
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)" }}>Bookopis · CMD-K</span>
      </div>
    </div>
  </div>
);

const FocusMode = () => (
  <div style={{ height: "100%", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
    <div className="lw-paper" style={{ flex: 1, padding: "80px 32px", overflow: "auto" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div className="lw-italic-muted" style={{ fontSize: 13, marginBottom: 8 }}>Глава 4</div>
        <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1.15, margin: 0, color: "var(--text-strong)" }}>Разговор о невозможном</h1>
        <div className="lw-prose" style={{ marginTop: 36 }}>
          <p>Однажды весною, в час небывало жаркого заката, в Москве, на Патриарших прудах, появились двое граждан. Первый из них, одетый в летнюю серенькую пару, был маленького роста, упитан, лыс, свою приличную шляпу пирожком нёс в руке, а на хорошо выбритом лице его помещались сверхъестественных размеров очки в чёрной роговой оправе.</p>
          <p>Второй — плечистый, рыжеватый, вихрастый молодой человек в заломленной на затылок клетчатой кепке — был в ковбойке, жёваных белых брюках и в чёрных тапочках. Они шли молча, и каждый из них думал о своём.</p>
          <p>Когда они проходили мимо третьей скамейки, пыльная аллея сама собой стихла.<span className="lw-caret" /></p>
        </div>
      </div>
    </div>
    <div style={{
      position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
      display: "flex", alignItems: "center", gap: 12,
      background: "var(--surface-2)", border: "1px solid var(--border)",
      borderRadius: 999, padding: "6px 14px",
      boxShadow: "var(--shadow-md)",
      fontSize: 11, color: "var(--text-muted)",
      fontFamily: "var(--font-mono)",
    }}>
      <Dot tone="green" /> 2 840 слов · 11 мин · фокус-режим
      <span style={{ color: "var(--text-faint)" }}>·</span>
      выйти <Kbd>⌘⇧F</Kbd>
    </div>
  </div>
);

const Toolkit = () => (
  <div style={{ background: "var(--bg)", padding: 32, height: "100%", overflow: "auto" }}>
    <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 28, margin: 0, color: "var(--text-strong)", marginBottom: 4 }}>Library Warm — примитивы</h1>
    <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 28 }}>Кнопки · пилюли · карточки · клавиши · точки · радар</div>

    <div className="lw-meta" style={{ marginBottom: 12 }}>Кнопки</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
      <Btn variant="primary" icon="sparkle">Сгенерировать</Btn>
      <Btn variant="primary" size="sm">Принять</Btn>
      <Btn variant="primary" size="lg" icon="plus">Новая глава</Btn>
      <Btn variant="secondary">Отмена</Btn>
      <Btn variant="ghost" icon="search">Поиск</Btn>
      <Btn variant="ink-red" icon="trash">Удалить навсегда</Btn>
      <Btn variant="link">Перейти к главе</Btn>
      <Btn variant="primary" disabled>Недоступно</Btn>
    </div>

    <div className="lw-meta" style={{ marginBottom: 12 }}>Пилюли и точки</div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
      <Pill>черновик</Pill>
      <Pill tone="brass" icon="feather">Тёплый рассказчик</Pill>
      <Pill tone="green">готова</Pill>
      <Pill tone="amber">требуется правка</Pill>
      <Pill tone="red">конфликт канона</Pill>
      <Pill tone="blue">примечание</Pill>
      <span style={{ flex: 1 }} />
      <Dot tone="green" /><Dot tone="amber" /><Dot tone="red" /><Dot tone="blue" /><Dot tone="brass" />
    </div>

    <div className="lw-meta" style={{ marginBottom: 12 }}>Клавиши</div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
      <Kbd>⌘K</Kbd><Kbd>⌘S</Kbd><Kbd>⌘↵</Kbd><Kbd>⌘/</Kbd><Kbd>⌘⇧F</Kbd><Kbd>Esc</Kbd>
    </div>

    <div className="lw-meta" style={{ marginBottom: 12 }}>Поля</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24, maxWidth: 600 }}>
      <input className="lw-input" placeholder="Заголовок главы…" />
      <input className="lw-input" placeholder="Поиск" />
      <textarea className="lw-textarea" rows={3} placeholder="Свободный ввод…" />
      <div className="lw-progress" style={{ alignSelf: "center" }}><i style={{ width: "62%" }} /></div>
    </div>

    <div className="lw-meta" style={{ marginBottom: 12 }}>Цвета чернил</div>
    <div className="lw-prose" style={{ fontFamily: "Lora, Georgia, serif", marginBottom: 24, maxWidth: 640 }}>
      <p>
        Берлиоз остановился и повернул голову к спутнику с тем
        {" "}<span className="lw-add">медленным и осторожным</span>{" "}
        <span className="lw-del">быстрым</span> движением, каким человек поворачивается в темноте, услышав за спиной шаги.
      </p>
    </div>

    <div className="lw-meta" style={{ marginBottom: 12 }}>Карточки</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24, maxWidth: 900 }}>
      <Card>
        <div className="lw-meta">Стат-карточка</div>
        <Mono style={{ fontSize: 24, color: "var(--text-strong)", display: "block", marginTop: 8 }}>48 200</Mono>
      </Card>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Dot tone="amber" />
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", flex: 1 }}>Замечание</div>
          <Pill tone="brass">critic</Pill>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Длинное предложение во втором абзаце.</div>
      </Card>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Radar size={80} values={[78,52,88,64,58,72]} />
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--text-strong)" }}>Тёплый рассказчик</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>3 книги</div>
          </div>
        </div>
      </Card>
    </div>

    <div className="lw-meta" style={{ marginBottom: 12 }}>Палитра</div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {[
        ["bg","#1A1410"], ["surface-1","#221A14"], ["surface-2","#2B2118"], ["surface-3","#342719"],
        ["brass","#D49A4E"], ["brass-soft","#B07F33"],
        ["ink-red","#C44536"], ["ink-green","#6A8E4E"], ["ink-blue","#5B7A99"], ["ink-amber","#C9A24A"],
        ["text","#EDE4D3"], ["text-muted","#9C8B73"], ["text-faint","#6E5F4D"],
      ].map(([n,c]) => (
        <div key={n} style={{ width: 100, fontSize: 11 }}>
          <div style={{ height: 56, borderRadius: 8, background: c, border: "1px solid var(--border-soft)" }} />
          <div style={{ marginTop: 6, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{n}</div>
          <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{c}</div>
        </div>
      ))}
    </div>
  </div>
);

Object.assign(window, { CommandPalette, FocusMode, Toolkit });
