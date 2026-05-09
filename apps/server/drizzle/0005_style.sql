CREATE TABLE `reference_corpora` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`filename` text NOT NULL,
	`format` text NOT NULL,
	`language` text DEFAULT 'ru' NOT NULL,
	`raw_text` text NOT NULL,
	`char_count` integer NOT NULL,
	`scene_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `style_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ref_format_check" CHECK("reference_corpora"."format" IN ('txt','md','fb2','epub'))
);
--> statement-breakpoint
CREATE INDEX `idx_ref_corpora_profile` ON `reference_corpora` (`profile_id`);--> statement-breakpoint
CREATE TABLE `reference_scenes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`corpus_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`corpus_id`) REFERENCES `reference_corpora`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ref_scenes_corpus` ON `reference_scenes` (`corpus_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `style_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`language` text DEFAULT 'ru' NOT NULL,
	`description` text,
	`fingerprint_json` text,
	`fatigue_words_json` text,
	`last_extracted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `books` ADD `style_profile_id` integer REFERENCES style_profiles(id);