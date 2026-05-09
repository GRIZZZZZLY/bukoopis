CREATE TABLE `critique_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chapter_version_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`report_json` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`chapter_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "critique_status_check" CHECK("critique_reports"."status" IN ('pending','done','error'))
);
--> statement-breakpoint
CREATE INDEX `idx_critique_version` ON `critique_reports` (`chapter_version_id`);