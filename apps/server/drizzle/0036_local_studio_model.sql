-- Migration 0036_local_studio_model
-- Hand-written SQL. Separate statements with the breakpoint marker
-- (see prior migrations); never put that marker inside a comment.

ALTER TABLE `books` ADD COLUMN `studio_provider` text NOT NULL DEFAULT 'anthropic' CHECK (`studio_provider` IN ('anthropic','ollama'));--> statement-breakpoint
ALTER TABLE `books` ADD COLUMN `studio_local_model` text;
