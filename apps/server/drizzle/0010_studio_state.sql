CREATE TABLE `studio_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`stage_id` text,
	`aspect_id` text,
	`payload` text NOT NULL,
	`revision_before` integer NOT NULL,
	`revision_after` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_events_event_type_check" CHECK(`event_type` IN (
		'accept_variant','reject_variant','refine_variant','regen_variant',
		'materialize_entity_set','entity_review_decision',
		'import_merge','cross_book_copy','stage_skip',
		'playbook_generate','aspect_create_manual','aspect_delete'
	))
);
--> statement-breakpoint
CREATE INDEX `idx_studio_events_book_created` ON `studio_events` (`book_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `books` ADD COLUMN `concept` text;--> statement-breakpoint
ALTER TABLE `books` ADD COLUMN `studio_state` text;
