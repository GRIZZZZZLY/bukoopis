-- Migration 0021_critique_partial
-- Статус разбора «часть критиков отработала, часть упала» не существовал, и
-- агрегация выдавала такой прогон за успешный. SQLite не меняет CHECK через
-- ALTER TABLE, поэтому таблица пересобирается: она маленькая и всегда
-- восстановима повторным запуском критики.

CREATE TABLE `critique_reports_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chapter_version_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`report_json` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`chapter_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "critique_status_check" CHECK(`status` IN ('pending','done','partial','error'))
);--> statement-breakpoint
INSERT INTO `critique_reports_new`
  (`id`, `chapter_version_id`, `status`, `report_json`, `error_message`, `created_at`, `completed_at`)
SELECT `id`, `chapter_version_id`, `status`, `report_json`, `error_message`, `created_at`, `completed_at`
FROM `critique_reports`;--> statement-breakpoint
DROP TABLE `critique_reports`;--> statement-breakpoint
ALTER TABLE `critique_reports_new` RENAME TO `critique_reports`;--> statement-breakpoint
CREATE INDEX `idx_critique_version` ON `critique_reports` (`chapter_version_id`);
