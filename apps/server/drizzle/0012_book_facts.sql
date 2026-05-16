CREATE TABLE `book_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`entity_name` text NOT NULL,
	`predicate` text NOT NULL,
	`object_text` text NOT NULL,
	`valid_from_chapter` integer NOT NULL,
	`valid_to_chapter` integer,
	`source_version_id` integer,
	`confidence` real DEFAULT 1.0 NOT NULL,
	`superseded_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`superseded_by`) REFERENCES `book_facts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "book_facts_entity_type_check" CHECK(`entity_type` IN ('character','location','item','world'))
);--> statement-breakpoint
CREATE INDEX `idx_book_facts_lookup` ON `book_facts` (`book_id`,`entity_type`,`entity_name`,`valid_from_chapter`);--> statement-breakpoint
CREATE INDEX `idx_book_facts_active` ON `book_facts` (`book_id`,`valid_from_chapter`,`valid_to_chapter`);
