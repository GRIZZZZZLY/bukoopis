CREATE TABLE `chapter_canon_extractions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chapter_id` integer NOT NULL,
	`version_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text NOT NULL,
	`error_message` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `canon_extractions_status_check` CHECK(`status` IN ('pending','ready','error'))
);
--> statement-breakpoint
CREATE INDEX `idx_canon_extractions_chapter` ON `chapter_canon_extractions` (`chapter_id`);
--> statement-breakpoint
CREATE TABLE `entity_chapter_mentions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`book_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`mention_count` integer DEFAULT 1 NOT NULL,
	`quote` text,
	`first_seen_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `mentions_entity_type_check` CHECK(`entity_type` IN ('character','location','item','hook','relationship'))
);
--> statement-breakpoint
CREATE INDEX `idx_mentions_chapter` ON `entity_chapter_mentions` (`chapter_id`);
--> statement-breakpoint
CREATE INDEX `idx_mentions_entity` ON `entity_chapter_mentions` (`entity_type`,`entity_id`);
--> statement-breakpoint
CREATE INDEX `idx_mentions_book` ON `entity_chapter_mentions` (`book_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mentions_unique` ON `entity_chapter_mentions` (`entity_type`,`entity_id`,`chapter_id`);
