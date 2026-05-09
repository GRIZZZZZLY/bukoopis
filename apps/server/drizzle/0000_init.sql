CREATE TABLE `books` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`language` text DEFAULT 'ru' NOT NULL,
	`premise` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "books_status_check" CHECK("books"."status" IN ('draft','active','archived'))
);
--> statement-breakpoint
CREATE TABLE `chapter_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chapter_id` integer NOT NULL,
	`parent_version_id` integer,
	`content_json` text NOT NULL,
	`content_text` text NOT NULL,
	`word_count` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`branch_label` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chapter_versions_source_check" CHECK("chapter_versions"."source" IN ('manual','agent'))
);
--> statement-breakpoint
CREATE INDEX `idx_chapter_versions_chapter_created` ON `chapter_versions` (`chapter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`title` text NOT NULL,
	`current_version_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chapters_status_check" CHECK("chapters"."status" IN ('draft','in_review','final'))
);
--> statement-breakpoint
CREATE INDEX `idx_chapters_book_order` ON `chapters` (`book_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `_health` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL
);
