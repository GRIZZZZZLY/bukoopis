-- Migration 0014_memory_pipeline
-- ADR 0002 — schema foundation for the durable memory pipeline (P0).
-- Behavior lands in later steps; this migration only adds structure.
-- NOTE: the breakpoint marker must appear ONLY between statements — the
-- migrator splits on that literal string, even inside comments.

CREATE TABLE `memory_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`chapter_version_id` integer NOT NULL,
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
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_jobs_kind_check" CHECK(`kind` IN ('index','summary','facts','notes','rollup')),
	CONSTRAINT "memory_jobs_status_check" CHECK(`status` IN ('pending','running','retry','done','error','obsolete'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memory_jobs_version_kind` ON `memory_jobs` (`chapter_version_id`,`kind`,`pipeline_version`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_claim` ON `memory_jobs` (`status`,`run_after`,`book_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_jobs_version` ON `memory_jobs` (`chapter_version_id`,`kind`);--> statement-breakpoint
CREATE TABLE `chapter_drafts` (
	`chapter_id` integer PRIMARY KEY NOT NULL,
	`content_json` text NOT NULL,
	`content_text` text NOT NULL,
	`word_count` integer NOT NULL,
	`base_version_id` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
ALTER TABLE `chapters` ADD COLUMN `memory_version_id` integer REFERENCES `chapter_versions`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `books` ADD COLUMN `memory_stale_from_chapter_order` integer;--> statement-breakpoint
ALTER TABLE `book_facts` ADD COLUMN `origin` text DEFAULT 'extracted' NOT NULL CHECK(`origin` IN ('manual','studio','extracted','legacy'));--> statement-breakpoint
ALTER TABLE `book_notes` ADD COLUMN `origin` text DEFAULT 'extracted' NOT NULL CHECK(`origin` IN ('manual','studio','extracted','legacy'));--> statement-breakpoint
-- Existing rows predate provenance-aware extraction: source_version_id already
-- exists on both tables but was best-effort. Mark history honestly as legacy
-- instead of inventing provenance (ADR 0002, "Legacy-данные").
UPDATE `book_facts` SET `origin` = 'legacy';--> statement-breakpoint
UPDATE `book_notes` SET `origin` = 'legacy';--> statement-breakpoint
-- Backfill memory_version_id ONLY where the current version really has chunks
-- (i.e. it was finalized and indexed). Autosave-draft versions stay NULL.
UPDATE `chapters` SET `memory_version_id` = `current_version_id`
WHERE `current_version_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `chunks`
    WHERE `chunks`.`source_type` = 'chapter_version'
      AND `chunks`.`source_id` = `chapters`.`current_version_id`
  );--> statement-breakpoint
-- Books where some committed chapter has no built memory start out stale from
-- the first such chapter — honest state instead of claiming freshness.
UPDATE `books` SET `memory_stale_from_chapter_order` = (
  SELECT MIN(`c`.`order_index`) FROM `chapters` `c`
  WHERE `c`.`book_id` = `books`.`id`
    AND `c`.`current_version_id` IS NOT NULL
    AND `c`.`memory_version_id` IS NULL
)
WHERE EXISTS (
  SELECT 1 FROM `chapters` `c`
  WHERE `c`.`book_id` = `books`.`id`
    AND `c`.`current_version_id` IS NOT NULL
    AND `c`.`memory_version_id` IS NULL
);
