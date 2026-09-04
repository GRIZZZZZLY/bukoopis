// BooksList, BookPage (with all 5 tabs), StyleProfiles, Usage, NotFound, Errors

const BookCard = ({ title, meta, chapters, words, edited, status, statusTone }) => (
  <div style={{
    width: 320, background: "var(--surface-1)",
    border: "1px solid var(--border-soft)", borderRadius: 12,
    overflow: "hidden", cursor: "pointer",
    transition: "all 200ms cubic-bezier(0.22, 0.9, 0.32, 1)",
  }}>
    <div className="lw-spine" />
    <div className="lw-paper" style={{ padding: 18, position: "relative" }}>
      <div className="lw-display" style={{ fontSize: 22, color: "var(--text-strong)", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{meta}</div>
      <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
        <Mono style={{ fontSize: 12, color: "var(--text-muted)" }}>{chapters} глав</Mono>
        <Mono style={{ fontSize: 12, color: "var(--text-muted)" }}>{words}</Mono>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-faint)", flex: 1 }}>{edited}</span>
        <Pill tone={statusTone}>{status}</Pill>
      </div>
    </div>
  </div>
);

const BooksList = () => {
  const books = [
    { title: "Стальные ливни", meta: "Военная проза · А. Кулагин", chapters: 12, words: "48 200", edited: "2 ч назад", status: "редактируется", statusTone: "blue" },
    { title: "Тёплая зима", meta: "Магический реализм", chapters: 7, words: "21 040", edited: "вчера", status: "черновик", statusTone: "amber" },
    { title: "Лестница", meta: "Психологический триллер", chapters: 24, words: "92 800", edited: "3 дня", status: "готова", statusTone: "green" },
    { title: "Вешние воды", meta: "Литературная фантастика", chapters: 5, words: "14 320", edited: "неделю назад", status: "черновик", statusTone: "amber" },
    { title: "Север, далее везде", meta: "Документальный роман", chapters: 18, words: "76 110", edited: "месяц назад", status: "редактируется", statusTone: "blue" },
    { title: "Из жизни сторожа Г.", meta: "Сборник рассказов", chapters: 9, words: "34 800", edited: "месяц назад", status: "готова", statusTone: "green" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar crumbs={[{ label: "Книги", bold: true }]} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <LeftRail active="books" />
        <div style={{ flex: 1, overflow: "auto", padding: "32px 48px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 28, gap: 20 }}>
            <div style={{ flex: 1 }}>
              <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 32, margin: 0, color: "var(--text-strong)" }}>Ваши книги</h1>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>
                12 книг · последняя правка <span style={{ color: "var(--text)" }}>2 ч. назад</span>
              </div>
            </div>
            <Btn variant="primary" icon="plus">Новая книга</Btn>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {books.map((b, i) => <BookCard key={i} {...b} />)}
          </div>

          <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            <Skel h={220} r={12} />
            <Skel h={220} r={12} />
            <Skel h={220} r={12} />
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
};

// ----------------------------------------------------------
// BookPage — three-pane with tabs
// ----------------------------------------------------------
const BookOutlinePanel = () => {
  const items = [
    { type: "part", title: "Часть I — Покой" },
    { n: 1, title: "Перед грозой", words: 3120 },
    { n: 2, title: "Незваный гость", words: 4580 },
    { n: 3, title: "На Патриарших", words: 5210 },
    { type: "part", title: "Часть II — Гроза" },
    { n: 4, title: "Разговор о невозможном", words: 2840, active: true },
    { n: 5, title: "Воланд", words: 0 },
    { n: 6, title: "Берлиоз и трамвай", words: 0 },
    { n: 7, title: "Иван у психиатра", words: 0 },
  ];
  return (
    <div style={{ width: 280, borderRight: "1px solid var(--border-soft)", background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border-soft)" }}>
        <div className="lw-meta" style={{ flex: 1 }}>План</div>
        <button className="lw-railbtn" style={{ width: 24, height: 24 }}><Icon name="search" size={14} /></button>
        <button className="lw-railbtn" style={{ width: 24, height: 24 }}><Icon name="plus" size={14} /></button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        {items.map((it, i) => (
          it.type === "part" ? (
            <div key={i} className="lw-meta" style={{ padding: "12px 10px 6px", color: "var(--text-faint)" }}>{it.title}</div>
          ) : (
            <div key={i} style={{
              position: "relative", padding: "8px 10px", borderRadius: 6, cursor: "pointer",
              background: it.active ? "var(--surface-2)" : "transparent",
              display: "flex", alignItems: "baseline", gap: 8
            }}>
              {it.active && <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, background: "var(--brass)", borderRadius: 2 }} />}
              <Mono style={{ fontSize: 11, color: "var(--text-faint)" }}>{String(it.n).padStart(2,"0")}</Mono>
              <span style={{ flex: 1, fontSize: 13, color: it.active ? "var(--text-strong)" : "var(--text)" }}>{it.title}</span>
              <Mono style={{ fontSize: 10, color: "var(--text-faint)" }}>{it.words || "—"}</Mono>
            </div>
          )
        ))}
      </div>
    </div>
  );
};

const Inspector = () => (
  <div style={{ width: 360, borderLeft: "1px solid var(--border-soft)", background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
    <div style={{ padding: "10px 16px 0", borderBottom: "1px solid var(--border-soft)" }}>
      <div className="lw-tabs" style={{ borderBottom: "none" }}>
        {["Метаданные","Стиль","История"].map((t,i) => (
          <button key={t} className="lw-tab" data-active={i===1} style={{ padding: "10px 12px", fontSize: 13 }}>{t}</button>
        ))}
      </div>
    </div>
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      <div className="lw-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="lw-meta" style={{ marginBottom: 12 }}>Профиль стиля</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Pill tone="brass" icon="feather">Тёплый рассказчик</Pill>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>извлечён из гл. 1–3</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 16px" }}>
          <Radar size={200} values={[78,52,88,64,58,72]} labels={["тон","темп","лекс.","образ.","диал.","ритм"]} />
        </div>
        <Btn variant="secondary" icon="sparkle" style={{ width: "100%" }}>Извлечь из этой главы</Btn>
      </div>

      <div className="lw-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="lw-meta" style={{ marginBottom: 12 }}>Запреты</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {["канцелярит","разговорная брань","анахронизмы","современный сленг"].map(t => (
            <Pill key={t} tone="red">{t}</Pill>
          ))}
        </div>
      </div>

      <div className="lw-card" style={{ padding: 16 }}>
        <div className="lw-meta" style={{ marginBottom: 12 }}>Образцы стиля</div>
        <div style={{ fontFamily: "var(--font-prose)", fontStyle: "italic", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          «И ничего иного не оставалось ему: только смотреть в это пыльное небо, где едва угадывалось обещание грозы, и думать о том, как тиха стала аллея.»
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-faint)" }}>— гл. 2, фр. 18</div>
      </div>
    </div>
  </div>
);

const BookOverview = () => {
  return (
    <div style={{ padding: "28px 36px" }}>
      <div style={{ display: "flex", gap: 32, alignItems: "flex-start", marginBottom: 32 }}>
        <div style={{ flex: 1 }}>
          <div className="lw-meta" style={{ marginBottom: 10 }}>Военная проза</div>
          <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 40, margin: 0, color: "var(--text-strong)", lineHeight: 1.1 }}>Стальные ливни</h1>
          <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>А. Кулагин · 2025 · русский</div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Pill icon="feather">Тёплый рассказчик</Pill>
            <Pill tone="blue">редактируется</Pill>
            <Pill>взрослая аудитория</Pill>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, minWidth: 460 }}>
          {[
            { label: "Всего слов", value: "48 200", delta: "+1 240" },
            { label: "Глав", value: "12 / 18" },
            { label: "Последняя правка", value: "2 ч", delta: "сегодня" },
          ].map((s,i) => (
            <div key={i} className="lw-card" style={{ padding: 16 }}>
              <div className="lw-meta">{s.label}</div>
              <Mono style={{ fontSize: 24, color: "var(--text-strong)", display: "block", marginTop: 8 }}>{s.value}</Mono>
              {s.delta && <div style={{ marginTop: 4, color: "var(--ink-green)", fontSize: 11, fontFamily: "var(--font-mono)" }}>▲ {s.delta}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="lw-meta" style={{ marginBottom: 14 }}>Лента глав</div>
      <div style={{ position: "relative", paddingLeft: 24 }}>
        <div style={{ position: "absolute", left: 5, top: 8, bottom: 8, width: 1, background: "var(--border)" }} />
        {[
          { n: 1, title: "Перед грозой", words: 3120, edited: "12 апр", status: "готова", tone: "green" },
          { n: 2, title: "Незваный гость", words: 4580, edited: "14 апр", status: "готова", tone: "green" },
          { n: 3, title: "На Патриарших", words: 5210, edited: "20 апр", status: "готова", tone: "green" },
          { n: 4, title: "Разговор о невозможном", words: 2840, edited: "сегодня", status: "редактируется", tone: "blue", active: true },
          { n: 5, title: "Воланд", words: 0, edited: "—", status: "черновик", tone: "amber" },
          { n: 6, title: "Берлиоз и трамвай", words: 0, edited: "—", status: "черновик", tone: "amber" },
        ].map((c) => (
          <div key={c.n} style={{
            position: "relative", padding: "12px 16px", marginLeft: -8,
            display: "flex", alignItems: "center", gap: 14, borderRadius: 8,
            background: c.active ? "var(--surface-2)" : "transparent",
            cursor: "pointer", marginBottom: 4,
          }}>
            <span style={{
              position: "absolute", left: -3, top: "50%", marginTop: -5,
              width: 10, height: 10, borderRadius: 999,
              background: c.active ? "var(--brass)" : "var(--surface-3)",
              border: `2px solid ${c.active ? "var(--brass-soft)" : "var(--border)"}`,
            }} />
            <Mono style={{ fontSize: 12, color: "var(--text-faint)", width: 28 }}>гл. {c.n}</Mono>
            <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>{c.title}</span>
            <Mono style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.words || "—"} слов</Mono>
            <span style={{ fontSize: 12, color: "var(--text-faint)", width: 80, textAlign: "right" }}>{c.edited}</span>
            <Pill tone={c.tone}>{c.status}</Pill>
            <Icon name="chevR" size={14} style={{ color: "var(--text-faint)" }} />
          </div>
        ))}
      </div>
    </div>
  );
};

const PlanTab = () => (
  <div style={{ padding: "28px 36px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: 0, color: "var(--text-strong)", flex: 1 }}>Сюжетные узлы</h2>
        <Btn variant="secondary" size="sm" icon="plus">Новый узел</Btn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { act: "Завязка", title: "Жара на Патриарших", body: "Берлиоз и Бездомный встречают Воланда. Закладывается мотив грозы — ещё не пришедшей." },
          { act: "Развитие", title: "Разговор о невозможном", body: "Воланд намекает на свою природу; Берлиоз отрицает. Пророчество о трамвае." },
          { act: "Перелом", title: "Берлиоз и трамвай", body: "Сбывается первое предсказание. Иван бросается в погоню." },
          { act: "Развязка (?)", title: "Иван у психиатра", body: "Под вопросом: оставить ли больничную сцену в этом томе или вынести во второй?" },
        ].map((b,i) => (
          <div key={i} className="lw-card" style={{ padding: 16, display: "flex", gap: 14 }}>
            <Icon name="grip" size={16} style={{ color: "var(--text-faint)", marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div className="lw-meta" style={{ marginBottom: 4 }}>{b.act}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 4 }}>{b.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{b.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
    <div>
      <div className="lw-meta" style={{ marginBottom: 12 }}>Предложения ИИ <Pill tone="brass" style={{ marginLeft: 6 }}>3 новых</Pill></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { title: "Вставить эпилог-ретроспективу", body: "Ретроспективный взгляд Иванушки в эпилоге свяжет первую и вторую части." },
          { title: "Перенести «Воланд» вперёд", body: "Главу 5 имеет смысл сдвинуть на 4-ю позицию для лучшего темпа." },
          { title: "Углубить мотив грозы", body: "Гроза проброшена в гл. 4, но не возвращается. Можно посеять в гл. 6." },
        ].map((s,i) => (
          <div key={i} className="lw-card" style={{ padding: 14, borderLeft: "3px solid var(--brass)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{s.body}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn variant="primary" size="sm">Принять</Btn>
              <Btn variant="ghost" size="sm">Отклонить</Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const CanonTab = () => (
  <div style={{ padding: "28px 36px" }}>
    <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
      {["Все","Персонажи","Места","События","Предметы","Время"].map((c,i) => (
        <Pill key={c} tone={i===0?"brass":undefined}>{c}</Pill>
      ))}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {[
        { s: "Берлиоз", p: "является", o: "редактором журнала", chap: "гл. 1" },
        { s: "Бездомный", p: "пишет", o: "антирелигиозную поэму", chap: "гл. 1" },
        { s: "Патриаршие", p: "имеют", o: "три скамейки на аллее", chap: "гл. 3" },
        { s: "Воланд", p: "появляется", o: "в час жаркого заката", chap: "гл. 4", warn: true },
        { s: "Гроза", p: "обещана", o: "в воздухе, ещё не пришла", chap: "гл. 4" },
        { s: "Трамвай (Аннушка)", p: "пройдёт", o: "по Бронной", chap: "гл. 6" },
      ].map((f,i) => (
        <div key={i} className="lw-card" style={{ padding: 16, position: "relative", ...(f.warn && { borderLeft: "3px solid var(--ink-red)" }) }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: "var(--text-strong)", fontSize: 14 }}>{f.s}</span>
            <span style={{ color: "var(--text-faint)", fontSize: 12, fontStyle: "italic" }}>{f.p}</span>
            <span style={{ flex: 1, color: "var(--text)", fontSize: 14 }}>{f.o}</span>
            <a className="lw-link" style={{ fontSize: 12 }}>{f.chap}</a>
          </div>
          {f.warn && <div style={{ fontSize: 11, color: "var(--ink-red)", marginTop: 6 }}>⚠ Похожий факт уже зафиксирован в гл. 1 — проверьте на дубль.</div>}
        </div>
      ))}
    </div>
    <div style={{ marginTop: 24, padding: 16, background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border-soft)" }}>
      <div className="lw-meta" style={{ marginBottom: 8 }}>Добавить факт</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
        <input className="lw-input" placeholder="Субъект" />
        <input className="lw-input" placeholder="Действие" />
        <input className="lw-input" placeholder="Объект / описание" />
        <Btn variant="primary">Добавить</Btn>
      </div>
    </div>
  </div>
);

const KnowledgeTab = () => (
  <div style={{ padding: "28px 36px", display: "grid", gridTemplateColumns: "200px 1fr", gap: 24 }}>
    <div>
      <div style={{ position: "relative", marginBottom: 14 }}>
        <input className="lw-input" placeholder="Поиск…" style={{ paddingLeft: 28 }} />
        <span style={{ position: "absolute", left: 8, top: 9, color: "var(--text-faint)" }}><Icon name="search" size={14} /></span>
      </div>
      <div className="lw-meta" style={{ marginBottom: 8 }}>Категории</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {[
          ["Все","32"], ["Персонажи","8"], ["Места","6"], ["Лор","11"], ["Эпоха","7"]
        ].map(([n,c],i) => (
          <button key={n} className="lw-railbtn" data-active={i===0} style={{ width: "100%", justifyContent: "flex-start", padding: "8px 10px", height: "auto" }}>
            <span style={{ flex: 1, textAlign: "left", fontSize: 13 }}>{n}</span>
            <Mono style={{ fontSize: 11, color: "var(--text-faint)" }}>{c}</Mono>
          </button>
        ))}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {[
        { tag: "Персонаж", title: "Берлиоз, Михаил Александрович", body: "Председатель МАССОЛИТа. Эрудит, прагматик. Лысина, очки в роговой оправе. Идеологически непреклонен." },
        { tag: "Место", title: "Патриаршие пруды", body: "Сквер с тремя скамейками на главной аллее. В жару — почти безлюдны. Ключевая точка для встреч." },
        { tag: "Лор", title: "Свита Воланда", body: "Коровьев, Бегемот, Азазелло, Гелла. Появляются по нарастающей, начиная с гл. 7." },
        { tag: "Эпоха", title: "Москва 1930-х", body: "Атеистическая пропаганда, дефицит, коммуналки. Анахронизмы — в стоп-лист стиля." },
      ].map((k,i) => (
        <div key={i} className="lw-card" style={{ padding: 16 }}>
          <Pill tone="blue" style={{ marginBottom: 8 }}>{k.tag}</Pill>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>{k.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>{k.body}</div>
        </div>
      ))}
    </div>
  </div>
);

const ImportExportTab = () => (
  <div style={{ padding: "28px 36px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
    <div>
      <h3 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 20, margin: "0 0 14px", color: "var(--text-strong)" }}>Импорт</h3>
      <div className="lw-paper" style={{
        border: "1.5px dashed var(--brass-soft)",
        borderRadius: 12, padding: 36,
        textAlign: "center", color: "var(--text-muted)",
      }}>
        <Icon name="upload" size={28} style={{ color: "var(--brass)", marginBottom: 10 }} />
        <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 4 }}>Перетащите файл сюда</div>
        <div style={{ fontSize: 12, marginBottom: 14 }}>или нажмите, чтобы выбрать</div>
        <Btn variant="secondary" size="sm">Выбрать файл</Btn>
      </div>
      <div className="lw-meta" style={{ marginTop: 18, marginBottom: 8 }}>Поддерживаемые форматы</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["txt","md","docx","fb2","epub"].map(f => <Pill key={f}>{f}</Pill>)}
      </div>
    </div>
    <div>
      <h3 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 20, margin: "0 0 14px", color: "var(--text-strong)" }}>Экспорт</h3>
      <div className="lw-card" style={{ padding: 18 }}>
        <div className="lw-meta" style={{ marginBottom: 10 }}>Формат</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {[["docx",true],["epub",false],["pdf",false],["md",false],["fb2",false]].map(([f,a]) => (
            <Pill key={f} tone={a?"brass":undefined}>{f}</Pill>
          ))}
        </div>
        <div className="lw-meta" style={{ marginBottom: 10 }}>Включить</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
          {[["Заметки критика", true], ["Канон-факты", false], ["План глав", true], ["История правок", false]].map(([n,a]) => (
            <label key={n} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text)" }}>
              <span style={{
                width: 16, height: 16, borderRadius: 4,
                border: "1px solid var(--border-strong)",
                background: a ? "var(--brass)" : "var(--surface-2)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: "#1A1410",
              }}>{a && <Icon name="check" size={11} stroke={2.5} />}</span>
              {n}
            </label>
          ))}
        </div>
        <div className="lw-meta" style={{ marginBottom: 8 }}>Прогресс</div>
        <div className="lw-progress" style={{ marginBottom: 14 }}><i style={{ width: "42%" }} /></div>
        <Btn variant="primary" icon="download" style={{ width: "100%" }}>Экспортировать</Btn>
      </div>
    </div>
  </div>
);

const BookPage = ({ tab = "Обзор" }) => {
  const tabs = [
    { id: "Обзор", label: "Обзор" },
    { id: "План", label: "План" },
    { id: "Канон", label: "Канон" },
    { id: "Знания", label: "Знания" },
    { id: "Импорт/Экспорт", label: "Импорт/Экспорт" },
  ];
  const Body =
    tab === "План" ? <PlanTab />
    : tab === "Канон" ? <CanonTab />
    : tab === "Знания" ? <KnowledgeTab />
    : tab === "Импорт/Экспорт" ? <ImportExportTab />
    : <BookOverview />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar crumbs={[{ label: "Книги" }, { label: "Стальные ливни", bold: true }]} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <LeftRail active="current" />
        <BookOutlinePanel />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "0 36px", borderBottom: "1px solid var(--border-soft)" }}>
            <Tabs items={tabs} active={tab} />
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>{Body}</div>
        </div>
        <Inspector />
      </div>
      <StatusBar />
    </div>
  );
};

// ----------------------------------------------------------
// StyleProfilesList
// ----------------------------------------------------------
const TraitMini = ({ values }) => {
  const labels = ["тон","темп","лекс.","образ.","диал.","ритм"];
  return <Radar size={120} values={values} labels={labels} />;
};

const StyleProfilesList = () => {
  const profiles = [
    { name: "Тёплый рассказчик", source: "из «Стальные ливни», гл. 1–3", uses: 3, values: [78,52,88,64,58,72] },
    { name: "Сухой летописец", source: "из «Север, далее везде»", uses: 1, values: [42,68,38,52,30,82] },
    { name: "Голос Бездомного", source: "ручной профиль", uses: 1, values: [62,82,48,72,88,40] },
    { name: "Магреализм", source: "из «Тёплая зима», гл. 1–4", uses: 2, values: [70,48,82,90,42,68] },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar crumbs={[{ label: "Профили стиля", bold: true }]} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <LeftRail active="style" />
        <div style={{ flex: 1, overflow: "auto", padding: "32px 48px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 28 }}>
            <div style={{ flex: 1 }}>
              <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 32, margin: 0, color: "var(--text-strong)" }}>Профили стиля</h1>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>4 профиля · единый голос для модели</div>
            </div>
            <Btn variant="primary" icon="plus">Новый профиль</Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
            {profiles.map((p,i) => (
              <div key={i} className="lw-card" style={{ padding: 22, display: "flex", gap: 20 }}>
                <TraitMini values={p.values} />
                <div style={{ flex: 1 }}>
                  <h3 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: 0, color: "var(--text-strong)" }}>{p.name}</h3>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, marginBottom: 14 }}>{p.source}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                    {["лиризм","паузы","метафора"].map(t => <Pill key={t}>{t}</Pill>)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>используется в {p.uses} {p.uses===1?"книге":"книгах"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
};

// ----------------------------------------------------------
// Usage page
// ----------------------------------------------------------
const UsagePage = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar crumbs={[{ label: "Использование", bold: true }]} />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <LeftRail active="usage" />
        <div style={{ flex: 1, overflow: "auto", padding: "32px 48px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 24, gap: 14 }}>
            <div style={{ flex: 1 }}>
              <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 32, margin: 0, color: "var(--text-strong)" }}>Использование</h1>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>Стоимость, токены, сессии</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["сегодня","7д","30д","свой"].map((p,i) => (
                <button key={p} className="lw-pill" data-tone={i===1?"brass":undefined} style={{ background: i===1?"rgba(212,154,78,0.08)":undefined }}>{p}</button>
              ))}
            </div>
            <Pill icon="globe">backend: api</Pill>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
            {[
              { label: "Всего токенов", v: "1 248 320", d: "+12.4%", up: true },
              { label: "Стоимость", v: "$24.18", d: "−4.2%", up: false },
              { label: "Сессий", v: "47", d: "+6", up: true },
            ].map((s,i) => (
              <div key={i} className="lw-card" style={{ padding: 18 }}>
                <div className="lw-meta">{s.label}</div>
                <Mono style={{ fontSize: 28, color: "var(--text-strong)", display: "block", marginTop: 10 }}>{s.v}</Mono>
                <Mono style={{ fontSize: 11, color: s.up ? "var(--ink-green)" : "var(--ink-red)", marginTop: 4, display: "block" }}>
                  {s.up ? "▲" : "▼"} {s.d} к прошлой неделе
                </Mono>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
            <div className="lw-card" style={{ padding: 18 }}>
              <div className="lw-meta" style={{ marginBottom: 14 }}>Токены по агентам</div>
              {[
                ["writer", 92], ["critic_prose", 58], ["style_extractor", 38],
                ["canon_check", 24], ["summarizer", 16], ["editor", 11],
              ].map(([n,v]) => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <Mono style={{ width: 130, fontSize: 11, color: "var(--text-muted)" }}>{n}</Mono>
                  <div style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 3 }}>
                    <div style={{ width: `${v}%`, height: "100%", background: "var(--brass)", borderRadius: 3 }} />
                  </div>
                  <Mono style={{ fontSize: 11, color: "var(--text)", width: 50, textAlign: "right" }}>{(v*4).toLocaleString()}k</Mono>
                </div>
              ))}
            </div>
            <div className="lw-card" style={{ padding: 18 }}>
              <div className="lw-meta" style={{ marginBottom: 14 }}>Стоимость во времени</div>
              <svg width="100%" height="160" viewBox="0 0 400 160" style={{ display: "block" }}>
                {[0.25, 0.5, 0.75].map((y,i) => <line key={i} x1="0" x2="400" y1={160*y} y2={160*y} stroke="var(--border-soft)" />)}
                <path d="M0 130 L40 110 L80 95 L120 105 L160 80 L200 65 L240 70 L280 50 L320 55 L360 35 L400 28"
                  fill="none" stroke="var(--brass)" strokeWidth="2" />
                <path d="M0 130 L40 110 L80 95 L120 105 L160 80 L200 65 L240 70 L280 50 L320 55 L360 35 L400 28 L400 160 L0 160 Z"
                  fill="rgba(212,154,78,0.10)" />
                {[0,1,2,3,4,5,6,7,8,9,10].map(i => (
                  <circle key={i} cx={i*40} cy={[130,110,95,105,80,65,70,50,55,35,28][i]} r="2.5" fill="var(--brass)" />
                ))}
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)", marginTop: 6 }}>
                {["пн","вт","ср","чт","пт","сб","вс"].map(d => <span key={d}>{d}</span>)}
              </div>
            </div>
          </div>

          <div className="lw-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 10 }}>
              <div className="lw-meta" style={{ flex: 1 }}>Журнал вызовов</div>
              <Btn variant="ghost" size="sm" icon="filter">Фильтр</Btn>
              <Btn variant="ghost" size="sm" icon="download">CSV</Btn>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  {["Время","Агент","Backend","Модель","Вход","Выход","Цена","Статус"].map(h => (
                    <th key={h} className="lw-meta" style={{ padding: "8px 14px", textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
                <tbody>
                {[
                  ["12:42","writer","api","claude-haiku-4-5","1 240","820","$0.018","ok"],
                  ["12:41","critic_prose","api","claude-haiku-4-5","2 100","640","$0.022","ok"],
                  ["12:38","style_extractor","subscription","gpt-5","3 800","210","$0.000","ok"],
                  ["12:35","canon_check","api","claude-haiku-4-5","920","180","$0.006","ok"],
                  ["12:30","writer","api","claude-haiku-4-5","640","2 040","$0.024","ok"],
                  ["12:24","summarizer","api","claude-haiku-4-5","4 200","380","$0.018","timeout"],
                ].map((r,i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    {r.map((c,j) => (
                      <td key={j} style={{
                        padding: "10px 14px",
                        fontFamily: j>=4 || j===0 ? "var(--font-mono)" : "var(--font-ui)",
                        color: j===7 ? (c==="ok" ? "var(--ink-green)" : "var(--ink-red)") : "var(--text)",
                      }}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
};

// ----------------------------------------------------------
// 404 / Error states
// ----------------------------------------------------------
const NotFound = () => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
    <TopBar crumbs={[{ label: "404" }]} />
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <LeftRail active="" />
      <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 40 }}>
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <Icon name="bookmark" size={40} style={{ color: "var(--brass)", marginBottom: 16 }} />
          <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 28, margin: 0, color: "var(--text-strong)" }}>Страница потерялась</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 10, marginBottom: 22 }}>
            Возможно, её перенесли в другую главу. Или закладка осталась в книге, которой больше нет.
          </p>
          <Btn variant="primary" icon="library">На главную</Btn>
        </div>
      </div>
    </div>
    <StatusBar />
  </div>
);

const ErrorAndStates = () => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
    <TopBar crumbs={[{ label: "Состояния", bold: true }]} />
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <LeftRail active="" />
      <div style={{ flex: 1, overflow: "auto", padding: "28px 40px" }}>
        <h1 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 28, margin: 0, color: "var(--text-strong)" }}>Состояния и реакции</h1>
        <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6, marginBottom: 24 }}>
          Загрузка, пустота, ошибки, конфликты, офлайн, оптимистичные действия — на все случаи.
        </div>

        {/* offline ribbon */}
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "var(--surface-2)", border: "1px solid var(--border-soft)",
          color: "var(--text-muted)", fontSize: 13, marginBottom: 12,
          display: "flex", alignItems: "center", gap: 10
        }}>
          <Dot tone="amber" /> Офлайн — изменения сохраняются локально, синхронизация при подключении.
        </div>

        {/* conflict ribbon */}
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "var(--surface-2)", borderLeft: "3px solid var(--ink-amber)",
          color: "var(--text)", fontSize: 13, marginBottom: 12,
          display: "flex", alignItems: "center", gap: 14
        }}>
          <span style={{ flex: 1 }}>Глава была изменена в другом окне. Объединить, перезагрузить или отменить?</span>
          <Btn variant="ghost" size="sm">Отменить</Btn>
          <Btn variant="secondary" size="sm">Перезагрузить</Btn>
          <Btn variant="primary" size="sm">Объединить</Btn>
        </div>

        {/* recoverable error */}
        <div style={{
          padding: "12px 14px", borderRadius: 8,
          background: "var(--surface-1)", borderLeft: "3px solid var(--ink-red)",
          marginBottom: 24
        }}>
          <div style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 600 }}>Не удалось загрузить разбор</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Сервер ответил 503. Попробуйте через минуту.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <Btn variant="ghost" size="sm" icon="undo">Повторить</Btn>
            <Mono style={{ fontSize: 11, color: "var(--text-faint)" }}>err: critic.unavailable · req_id 0x1f4a</Mono>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Empty state */}
          <div className="lw-card" style={{ padding: 36, textAlign: "center" }}>
            <Icon name="book" size={36} style={{ color: "var(--brass-soft)", marginBottom: 14 }} />
            <h3 className="lw-display" style={{ fontFamily: "var(--font-display)", fontSize: 20, margin: 0, color: "var(--text-strong)" }}>
              Здесь будет ваша первая книга
            </h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8, marginBottom: 18 }}>
              Импортируйте уже написанное или начните с чистой страницы — план поможет нащупать контуры.
            </p>
            <Btn variant="primary" icon="plus">Создать книгу</Btn>
          </div>

          {/* Loading skeleton */}
          <div className="lw-card" style={{ padding: 22 }}>
            <div className="lw-meta" style={{ marginBottom: 14 }}>Загрузка</div>
            <Skel h={20} w="60%" style={{ marginBottom: 12 }} />
            <Skel h={12} w="92%" style={{ marginBottom: 8 }} />
            <Skel h={12} w="80%" style={{ marginBottom: 8 }} />
            <Skel h={12} w="74%" style={{ marginBottom: 16 }} />
            <Skel h={120} w="100%" />
          </div>

          {/* Toasts */}
          <div className="lw-card" style={{ padding: 22 }}>
            <div className="lw-meta" style={{ marginBottom: 14 }}>Тосты</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="lw-toast">Глава 4 переименована · <a className="lw-link">Отменить</a></div>
              <div className="lw-toast" data-tone="success">Профиль стиля извлечён ✓</div>
              <div className="lw-toast" data-tone="error">Не удалось сохранить — повторим автоматически</div>
            </div>
          </div>

          {/* Destructive dialog mock */}
          <div className="lw-card" style={{ padding: 22 }}>
            <div className="lw-meta" style={{ marginBottom: 14 }}>Подтверждение удаления</div>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>Удалить «Стальные ливни»?</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Это действие необратимо. Введите название книги, чтобы подтвердить.
              </div>
              <input className="lw-input" placeholder="Стальные ливни" style={{ marginBottom: 14 }} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Btn variant="ghost">Отмена</Btn>
                <Btn variant="ink-red">Удалить навсегда</Btn>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <StatusBar />
  </div>
);

Object.assign(window, { BooksList, BookPage, StyleProfilesList, UsagePage, NotFound, ErrorAndStates });
