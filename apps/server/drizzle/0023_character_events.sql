-- Migration 0023_character_events
-- Hand-written SQL. Separate statements with the breakpoint marker
-- (see prior migrations); never put that marker inside a comment.

-- Этап 3 ТЗ индивидуальности персонажей: слой событий персонажа.
-- Знание — это вид события, а не отдельная таблица: два источника истины
-- расходятся на первой же правке (раздел 6, решение 5).

CREATE TABLE character_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  subject_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  addressee_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL,

  -- Граница сцены. Номер главы НЕ денормализуется: перестановка глав
  -- оставила бы тихо неверную границу, а join к chapters всегда верен.
  --
  -- CASCADE, а не SET NULL. Пустая глава означает «известно с самого начала»
  -- и видно на любой границе. При SET NULL удаление главы 8 превращало бы
  -- записанный в ней секрет ровно в такую запись — и он начинал светиться
  -- в подготовке главы 4. Это та самая утечка, против которой весь этап.
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  scene_ordinal INTEGER NOT NULL DEFAULT 0,

  -- CASCADE, а не SET NULL: доказательство события живёт в content_text этой
  -- версии. Без версии смещения показывают в пустоту, событие остаётся
  -- активным (verification = 'derived') и непроверяемым — ровно то состояние,
  -- которое запрещает AC-25. Заодно NULL здесь навсегда вывел бы строку
  -- из-под уникального индекса. Ручные и перенесённые события версии не
  -- имеют изначально и удалением главы не задеваются.
  source_version_id INTEGER REFERENCES chapter_versions(id) ON DELETE CASCADE,

  -- Доказательство в неизменяемом content_text указанной версии.
  evidence_quote TEXT,
  evidence_start INTEGER,
  evidence_end INTEGER,

  origin TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'derived',
  extractor_version INTEGER NOT NULL DEFAULT 1,

  -- Стабильный ключ для идемпотентности повторной обработки (AC-21).
  dedup_key TEXT NOT NULL,
  created_at TEXT NOT NULL,

  CONSTRAINT character_events_kind_check
    CHECK (kind IN ('knowledge','state','relation_shift','commitment')),
  CONSTRAINT character_events_origin_check
    CHECK (origin IN ('manual','llm','accepted_prose','migration')),
  CONSTRAINT character_events_verification_check
    CHECK (verification IN ('derived','proposed','confirmed','rejected')),
  CONSTRAINT character_events_scene_ordinal_check
    CHECK (scene_ordinal >= 0),
  CONSTRAINT character_events_extractor_version_check
    CHECK (extractor_version >= 1),
  CONSTRAINT character_events_evidence_start_check
    CHECK (evidence_start IS NULL OR evidence_start >= 0),
  CONSTRAINT character_events_evidence_end_check
    CHECK (evidence_end IS NULL OR evidence_end >= 0),
  CONSTRAINT character_events_evidence_range_check
    CHECK (evidence_start IS NULL OR evidence_end IS NULL OR evidence_end > evidence_start)
);
--> statement-breakpoint

-- Повторная обработка той же версии тем же извлекателем не плодит строк.
-- Версия входит в ключ: то же событие, найденное в ДРУГОЙ версии главы, —
-- отдельная запись со своим доказательством. Номер извлекателя входит по той
-- же причине: без него столбец extractor_version не значил бы ничего — при
-- его повышении новый разбор той же версии целиком гасился бы индексом,
-- то есть колонка существовала бы ровно ради случая, который ключ запрещает.
CREATE UNIQUE INDEX uq_character_events_dedup
  ON character_events (subject_character_id, kind, dedup_key,
                       source_version_id, extractor_version);
--> statement-breakpoint
CREATE INDEX idx_character_events_subject ON character_events (subject_character_id);
--> statement-breakpoint
CREATE INDEX idx_character_events_chapter ON character_events (chapter_id);
--> statement-breakpoint
CREATE INDEX idx_character_events_book ON character_events (book_id);
--> statement-breakpoint
CREATE INDEX idx_character_events_version ON character_events (source_version_id);
--> statement-breakpoint

-- Перенос существующих ручных знаний (раздел 6, решение 5). Происхождение
-- честно неполное: версии-источника и цитаты у этих строк нет и не будет,
-- выдумывать их запрещено (INV-07). `verification = 'confirmed'` — автор
-- ввёл их руками, это не гипотеза извлекателя.
INSERT INTO character_events
  (book_id, subject_character_id, addressee_character_id, kind, data_json,
   chapter_id, scene_ordinal, source_version_id,
   evidence_quote, evidence_start, evidence_end,
   origin, verification, extractor_version, dedup_key, created_at)
SELECT
  c.book_id,
  k.character_id,
  NULL,
  'knowledge',
  json_object('fact', k.fact, 'acquisition', 'observed',
              'source', NULL, 'canonFactId', NULL,
              'disprovedFromChapterOrder', NULL),
  k.learned_in_chapter_id,
  0,
  NULL,
  NULL, NULL, NULL,
  'migration',
  'confirmed',
  1,
  'legacy_knowledge:' || k.id,
  k.created_at
FROM character_knowledge k
JOIN characters c ON c.id = k.character_id;
