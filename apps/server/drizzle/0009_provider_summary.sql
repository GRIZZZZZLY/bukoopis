ALTER TABLE `books` ADD COLUMN `writer_provider` text DEFAULT 'anthropic' NOT NULL CHECK(`writer_provider` IN ('anthropic','ollama'));--> statement-breakpoint
ALTER TABLE `books` ADD COLUMN `writer_local_model` text;--> statement-breakpoint
ALTER TABLE `chapter_versions` ADD COLUMN `summary` text;
