-- Этап 2 ТЗ индивидуальности персонажей: профиль V2, ревизии, банк голоса.
-- Миграция ТОЛЬКО структурная. Ни одна строка profile_json не переписывается:
-- нормализация до V2 живёт на чтении (db/rows.ts), поэтому невозможно
-- потерять поле, которого мы сегодня не знаем (INV-07, раздел 15.4 ТЗ).

ALTER TABLE characters ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE relationships ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE relationships ADD COLUMN profile_json TEXT;--> statement-breakpoint

-- Одна таблица истории на персонажей и отношения. Полиморфная ссылка —
-- тот же приём, что у entity_aliases (entity_type + entity_id, без FK).
CREATE TABLE entity_profile_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  profile_json TEXT NOT NULL,
  origin TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK (entity_type IN ('character','relationship')),
  CHECK (origin IN ('author','llm','import','materialize','migration'))
);--> statement-breakpoint
CREATE UNIQUE INDEX uq_entity_profile_versions
  ON entity_profile_versions (entity_type, entity_id, revision);--> statement-breakpoint
CREATE INDEX idx_entity_profile_versions_entity
  ON entity_profile_versions (entity_type, entity_id);--> statement-breakpoint
CREATE INDEX idx_entity_profile_versions_book
  ON entity_profile_versions (book_id);--> statement-breakpoint

CREATE TABLE character_voice_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  situation TEXT NOT NULL,
  addressee_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  note TEXT,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  source_version_id INTEGER REFERENCES chapter_versions(id) ON DELETE SET NULL,
  source_chapter_order INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (situation IN ('neutral','conflict','vulnerable','authority','intimate','stranger')),
  CHECK (origin IN ('author','accepted_prose','llm')),
  CHECK (status IN ('proposed','accepted','rejected'))
);--> statement-breakpoint
CREATE INDEX idx_voice_samples_character
  ON character_voice_samples (character_id, status);--> statement-breakpoint
CREATE INDEX idx_voice_samples_book ON character_voice_samples (book_id);
