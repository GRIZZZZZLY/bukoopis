// app/data.js — placeholder data for the prototype

window.LW_DATA = (() => {
  const STAGES = [
    { id: "concept",    label: "Концепт",   icon: "Sparkles" },
    { id: "world",      label: "Мир",       icon: "Globe" },
    { id: "lore",       label: "Лор",       icon: "Stack" },
    { id: "characters", label: "Персонажи", icon: "Users" },
    { id: "items",      label: "Предметы",  icon: "Box" },
    { id: "plot",       label: "Сюжет",     icon: "Map" },
    { id: "chapters",   label: "Главы",     icon: "Book" },
  ];

  const BOOKS = [
    { id: 1, title: "Соляной свет", genre: "Тихое фэнтези", audience: "12+", chapters: 14, words: 47820, updated: "2 ч. назад", status: "active",
      recommended: "chapters", progress: { done: 5, total: 7, next: "Сюжет" },
      stages: { concept:"complete", world:"complete", lore:"complete", characters:"complete", items:"complete", plot:"in_progress", chapters:"todo" } },
    { id: 2, title: "Тоннели зимы", genre: "Психологический триллер", audience: "16+", chapters: 6, words: 18340, updated: "вчера", status: "draft",
      recommended: "characters", progress: { done: 2, total: 7, next: "Персонажи" },
      stages: { concept:"complete", world:"complete", lore:"in_progress", characters:"todo", items:"todo", plot:"todo", chapters:"todo" } },
    { id: 3, title: "Письма из Опоры", genre: "Эпистолярный роман", audience: "18+", chapters: 22, words: 92110, updated: "3 дня назад", status: "active",
      recommended: null, progress: { done: 7, total: 7, next: null },
      stages: { concept:"complete", world:"complete", lore:"complete", characters:"complete", items:"complete", plot:"complete", chapters:"complete" } },
    { id: 4, title: "Без обозначения", genre: "Гибрид жанров", audience: "—", chapters: 0, words: 0, updated: "только что", status: "draft",
      recommended: "concept", progress: { done: 0, total: 7, next: "Концепт" },
      stages: { concept:"todo", world:"todo", lore:"todo", characters:"todo", items:"todo", plot:"todo", chapters:"todo" } },
    { id: 5, title: "Якорная цепь", genre: "Семейная сага", audience: "16+", chapters: 9, words: 31200, updated: "неделю назад", status: "archive",
      recommended: null, progress: { done: 4, total: 7, next: "Предметы" },
      stages: { concept:"complete", world:"complete", lore:"complete", characters:"complete", items:"in_progress", plot:"skipped", chapters:"todo" } },
    { id: 6, title: "Перо в чернильнице", genre: "Магический реализм", audience: "14+", chapters: 11, words: 38900, updated: "вчера", status: "active",
      recommended: "plot", progress: { done: 5, total: 7, next: "Сюжет" },
      stages: { concept:"complete", world:"complete", lore:"complete", characters:"complete", items:"complete", plot:"in_progress", chapters:"todo" } },
  ];

  // for the chapter editor demo — book 1, chapter 4
  const CHAPTERS = [
    { id: 1, order: 1, title: "Соляной фонарь",           status: "complete", words: 3120 },
    { id: 2, order: 2, title: "Дочери залива",            status: "complete", words: 3870 },
    { id: 3, order: 3, title: "Что унесла отлив",          status: "complete", words: 2940 },
    { id: 4, order: 4, title: "Канделябр у северной стены", status: "revising", words: 4210 },
    { id: 5, order: 5, title: "Голос в раковине",          status: "draft",    words: 2180 },
    { id: 6, order: 6, title: "Письмо без адресата",       status: "outline",  words: 0 },
    { id: 7, order: 7, title: "Три ступени вниз",           status: "outline",  words: 0 },
  ];

  const CHAPTER_BODY = {
    title: "Канделябр у северной стены",
    chapter: 4,
    paragraphs: [
      "В ту ночь дом дышал ровнее, чем обычно. Лина слышала, как половицы поскрипывают под собственным весом, и не понимала — то ли это ветер просел в подполье, то ли кто-то очень осторожный поднимается по лестнице, и она не хочет ошибиться, как ошибалась мать.",
      "Канделябр у северной стены давно не зажигали. Шесть свечей, восковые потёки на бронзе, кружевная тень от листьев плюща за окном. Лина подошла ближе и поймала себя на странной мысли: если зажечь сегодня хотя бы одну свечу, кто-нибудь — кто-то, кто умеет читать такие знаки, — поймёт, что её снова можно навестить.",
      "— Не надо, — сказала она вслух, и собственный голос показался ей чужим. — Не надо, не надо.",
      "За дверью пахло солью и сухими розами, и этот запах не оставлял дом никогда — даже летом, даже когда море пряталось за двадцатью километрами полей. Лина опустила руку и долго смотрела на свечи, как смотрят на детей, которых ещё не научили говорить.",
      "Через стену кто-то засмеялся коротким, скомканным смехом — так смеются, когда уже не помнят, чему именно. Лина прислушалась, но больше ничего не последовало. Только шорох плюща и тонкий, чуть металлический шум — как если бы кто-то медленно перекладывал в кармане ключи.",
    ],
    streamingTail: "Она задержала дыхание и впервые за вечер позволила себе поверить, что",
  };

  const CRITIQUE = {
    verdicts: { logic: "warn", prose: "good", canon: "warn" },
    issues: [
      { id: "c1", tab: "Сюжет",  agent: "plot",     severity: "amber", title: "Мотивация Лины неясна",
        excerpt: "…если зажечь сегодня хотя бы одну свечу…", body: "Не показано, почему именно сегодня свеча — приглашение. В главе 2 этот ритуал не упоминался. Стоит добавить хотя бы один намёк раньше — или сделать догадку Лины открытой, без претензии на знание." },
      { id: "c2", tab: "Стиль",  agent: "style_extractor", severity: "blue", title: "Хороший ритм абзаца",
        excerpt: "Канделябр у северной стены давно не зажигали.", body: "Короткая фраза после длинной хорошо ставит сцену. Профиль стиля «Соляной свет» рекомендует ещё одно такое торможение в середине главы." },
      { id: "c3", tab: "Канон", agent: "canon_fact_extractor", severity: "red", title: "Канон: расстояние до моря",
        excerpt: "море пряталось за двадцатью километрами полей", body: "В главе 1 указано «семь километров до Залива». Двадцать — заметное расхождение. Привести к канону или зафиксировать смену сезона/локации.",
        suggestion: "семью километрами" },
      { id: "c4", tab: "Сюжет",  agent: "critique", severity: "amber", title: "Длинный внутренний абзац",
        excerpt: "В ту ночь дом дышал ровнее…", body: "Первый абзац держится на сравнениях, но действие откладывается. Возможно стоит начать с «Канделябр у северной стены давно не зажигали» — фраза тянет за собой сцену." },
        { id: "c5", tab: "Факты", agent: "episodic_note_extractor", severity: "blue", title: "Зафиксирован эпизод",
        excerpt: "Через стену кто-то засмеялся", body: "Добавить в эпизодические заметки как «соседский смех — повторяется в гл. 2 и 4»." },
    ],
  };

  const WARNINGS = [
    { id: "w1", severity: "amber", title: "Стадия «Сюжет» не завершена", body: "Принято 3 из 5 аспектов. Закройте оставшиеся, прежде чем переходить к главам — иначе писатель будет искать опору сам.", link: { route: "#/books/1/studio/plot", label: "К сюжету" } },
    { id: "w2", severity: "red",   title: "Расхождение с каноном",          body: "Глава 4 упоминает расстояние, которого нет в данных мира. Проверьте через рассогласование.", link: { route: "#/books/1/chapters/4", label: "Глава 4" } },
  ];

  const STYLE_PROFILES = [
    { id: 1, name: "Соляной свет",  source: "извлечён из «Соляной свет», гл. 1–3", usage: 1, traits: [62, 38, 78, 70, 44, 58] },
    { id: 2, name: "Зимний тоннель", source: "извлечён из «Тоннели зимы», гл. 1–2", usage: 1, traits: [28, 84, 40, 36, 72, 50] },
    { id: 3, name: "Письма",         source: "вручную, на основе классической прозы", usage: 2, traits: [70, 32, 92, 64, 22, 80] },
  ];
  const STYLE_AXES = ["тон", "темп", "лексика", "образность", "диалоги", "ритм"];

  const USAGE = {
    range: "7д",
    totals: { tokens: 1_842_603, costUsd: 21.74, sessions: 23, deltas: { tokens: +0.12, cost: -0.04, sessions: +0.08 } },
    byAgent: [
      { name: "writer",                tokens: 642_010, color: "var(--color-brass)" },
      { name: "critique",              tokens: 412_900, color: "var(--color-ink-red)" },
      { name: "plot",                  tokens: 281_400, color: "var(--color-ink-amber)" },
      { name: "style_extractor",       tokens: 168_220, color: "var(--color-ink-blue)" },
      { name: "summarizer",            tokens: 144_700, color: "var(--color-text-muted)" },
      { name: "canon_fact_extractor",  tokens:  98_400, color: "var(--color-ink-green)" },
      { name: "episodic_note_extractor", tokens: 94_973, color: "var(--color-border-strong)" },
    ],
    series: [
      { date: "Пн", usd: 2.10 }, { date: "Вт", usd: 3.40 }, { date: "Ср", usd: 4.21 },
      { date: "Чт", usd: 1.92 }, { date: "Пт", usd: 5.07 }, { date: "Сб", usd: 2.84 }, { date: "Вс", usd: 2.20 },
    ],
    table: [
      { time: "20.05 · 22:14", agent: "writer",   backend: "subscription", model: "sonnet", in: 4210, out: 1820, cost: 0.27, status: "ok" },
      { time: "20.05 · 22:10", agent: "critique", backend: "api",          model: "opus",   in: 6120, out: 2310, cost: 0.81, status: "ok" },
      { time: "20.05 · 21:46", agent: "plot",     backend: "api",          model: "sonnet", in: 2180, out: 1410, cost: 0.18, status: "ok" },
      { time: "20.05 · 21:31", agent: "style_extractor", backend: "subscription", model: "sonnet", in: 1860, out: 980, cost: 0.12, status: "ok" },
      { time: "20.05 · 21:14", agent: "writer",   backend: "subscription", model: "sonnet", in: 3920, out: 1640, cost: 0.25, status: "cancelled" },
    ],
  };

  const ASPECTS = [
    { id: "a1", title: "Атмосфера: соль, бронза, тёмная мебель", status: "accepted", body: "Дом — портовая дача XIX в. Канделябры в каждой комнате, потемневшее серебро, запах сухих роз. Свет всегда сбоку, не сверху." },
    { id: "a2", title: "География: семь километров до Залива",   status: "accepted", body: "Залив — узкая полоса воды между двумя обрывами. Семь километров полей и виноградника. Запах моря доходит при северном ветре." },
    { id: "a3", title: "Время: межсезонье, поздняя осень",        status: "reviewing", body: "Длинные сумерки, ранние ночи. Птицы уже ушли, листья ещё не опали. Снаружи всегда тише, чем внутри." },
    { id: "a4", title: "Народ Заливщины и их вера в «слышащих»",   status: "pending", body: "" },
    { id: "a5", title: "История Дома Канделябров (3 поколения)",   status: "pending", body: "" },
  ];

  const ENTITIES = {
    characters: [
      { id: "ch1", name: "Лина Аркадьевна Заслав", role: "Главная героиня", status: "materialized", traits: ["24 года", "наследует Дом", "слышит соседский смех"] },
      { id: "ch2", name: "Тётя Ева",               role: "Антагонист, мягкий", status: "candidate",    traits: ["живёт через стену", "приходит без приглашения"] },
      { id: "ch3", name: "Андрей",                 role: "Любовный интерес",  status: "candidate",    traits: ["рыбак", "молчун", "знает Залив"] },
      { id: "ch4", name: "Сёстры-близнецы Заслав",  role: "Эпизод",            status: "candidate",    traits: ["разница в три минуты", "одеваются одинаково"] },
    ],
  };

  return { STAGES, BOOKS, CHAPTERS, CHAPTER_BODY, CRITIQUE, WARNINGS, STYLE_PROFILES, STYLE_AXES, USAGE, ASPECTS, ENTITIES };
})();
