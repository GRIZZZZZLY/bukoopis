-- Состояние сцены: анкета непрерывности на версию главы.
-- docs/superpowers/specs/2026-09-21-scene-state-design.md

CREATE TABLE IF NOT EXISTS `chapter_scene_states` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `book_id` integer NOT NULL REFERENCES `books`(`id`) ON DELETE cascade,
  `chapter_id` integer NOT NULL REFERENCES `chapters`(`id`) ON DELETE cascade,
  `chapter_version_id` integer NOT NULL REFERENCES `chapter_versions`(`id`) ON DELETE cascade,
  `state_json` text NOT NULL,
  `origin` text DEFAULT 'llm' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `chapter_scene_states_origin_check` CHECK (`origin` IN ('llm','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_chapter_scene_states_version`
  ON `chapter_scene_states` (`chapter_version_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chapter_scene_states_chapter`
  ON `chapter_scene_states` (`chapter_id`);
--> statement-breakpoint

-- Новый вид задания очереди. `CHECK` в SQLite не меняется через ALTER TABLE
-- (ровно та причина, по которой на этапе 3 новый вид не заводили вовсе),
-- поэтому таблица пересоздаётся с переносом строк. Внешние ключи включены
-- (`foreign_keys = ON` в client.ts) и мешать не должны: на `memory_jobs` не
-- ссылается ни одна таблица, ссылки идут только из неё.
CREATE TABLE `memory_jobs_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `book_id` integer NOT NULL REFERENCES `books`(`id`) ON DELETE cascade,
  `chapter_id` integer NOT NULL REFERENCES `chapters`(`id`) ON DELETE cascade,
  `chapter_version_id` integer NOT NULL REFERENCES `chapter_versions`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `pipeline_version` integer DEFAULT 1 NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `run_after` text,
  `started_at` text,
  `finished_at` text,
  `last_error` text,
  `result_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `memory_jobs_kind_check` CHECK (`kind` IN ('index','summary','facts','notes','rollup','scene_state')),
  CONSTRAINT `memory_jobs_status_check` CHECK (`status` IN ('pending','running','retry','done','error','obsolete'))
);
--> statement-breakpoint
INSERT INTO `memory_jobs_new`
  (`id`, `book_id`, `chapter_id`, `chapter_version_id`, `kind`, `pipeline_version`,
   `status`, `attempts`, `run_after`, `started_at`, `finished_at`, `last_error`,
   `result_json`, `created_at`, `updated_at`)
SELECT
  `id`, `book_id`, `chapter_id`, `chapter_version_id`, `kind`, `pipeline_version`,
  `status`, `attempts`, `run_after`, `started_at`, `finished_at`, `last_error`,
  `result_json`, `created_at`, `updated_at`
FROM `memory_jobs`;
--> statement-breakpoint
DROP TABLE `memory_jobs`;
--> statement-breakpoint
ALTER TABLE `memory_jobs_new` RENAME TO `memory_jobs`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_jobs_claim`
  ON `memory_jobs` (`status`,`run_after`,`book_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_jobs_version`
  ON `memory_jobs` (`chapter_version_id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_memory_jobs_version_kind`
  ON `memory_jobs` (`chapter_version_id`,`kind`,`pipeline_version`);
