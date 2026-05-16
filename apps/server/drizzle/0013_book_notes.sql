CREATE TABLE `book_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`kind` text NOT NULL,
	`chapter_order_introduced` integer NOT NULL,
	`chapter_order_resolved` integer,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`embedding` blob,
	`tags` text DEFAULT '[]' NOT NULL,
	`related_note_ids` text DEFAULT '[]' NOT NULL,
	`source_version_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "book_notes_kind_check" CHECK(`kind` IN ('thread','foreshadow','arc_delta','theme','mystery'))
);--> statement-breakpoint
CREATE INDEX `idx_book_notes_open` ON `book_notes` (`book_id`,`chapter_order_resolved`);
