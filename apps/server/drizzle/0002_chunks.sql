CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`chapter_id` integer,
	`chapter_order` integer,
	`language` text DEFAULT 'ru' NOT NULL,
	`text` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`token_count` integer NOT NULL,
	`is_reference` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chunks_source_type_check" CHECK("chunks"."source_type" IN ('chapter_version','reference'))
);
--> statement-breakpoint
CREATE INDEX `idx_chunks_book_order` ON `chunks` (`book_id`,`chapter_order`);--> statement-breakpoint
CREATE INDEX `idx_chunks_source` ON `chunks` (`source_type`,`source_id`);