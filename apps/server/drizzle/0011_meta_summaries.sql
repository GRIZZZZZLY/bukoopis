CREATE TABLE `book_meta_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`covers_from_order` integer NOT NULL,
	`covers_to_order` integer NOT NULL,
	`summary_text` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_meta_summaries_book` ON `book_meta_summaries` (`book_id`);
