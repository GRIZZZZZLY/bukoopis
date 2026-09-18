-- Migration 0023_0023_character_events
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
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  scene_ordinal INTEGER NOT NULL DEFAULT 0,
  source_version_id INTEGER REFERENCES chapter_versions(id) ON DELETE SET NULL,

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

  CHECK (kind IN ('knowledge','state','relation_shift','commitment')),
  CHECK (origin IN ('manual','llm','accepted_prose','migration')),
  CHECK (verification IN ('derived','proposed','confirmed','rejected')),
  CHECK (scene_ordinal >= 0),
  CHECK (extractor_version >= 1),
  CHECK (evidence_start IS NULL OR evidence_start >= 0),
  CHECK (evidence_end IS NULL OR evidence_end >= 0),
  CHECK (evidence_start IS NULL OR evidence_end IS NULL OR evidence_end > evidence_start)
);
--> statement-breakpoint

-- Повторная обработка той же версии тем же извлекателем не плодит строк.
-- Версия входит в ключ: то же событие, найденное в ДРУГОЙ версии главы, —
-- отдельная запись со своим доказательством.
CREATE UNIQUE INDEX uq_character_events_dedup
  ON character_events (subject_character_id, kind, dedup_key, source_version_id);
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
