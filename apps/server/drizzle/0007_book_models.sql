ALTER TABLE `books` ADD COLUMN `writer_model` text DEFAULT 'opus' NOT NULL CHECK(`writer_model` IN ('sonnet','opus'));--> statement-breakpoint
ALTER TABLE `books` ADD COLUMN `plot_model` text DEFAULT 'sonnet' NOT NULL CHECK(`plot_model` IN ('sonnet','opus'));--> statement-breakpoint
ALTER TABLE `books` ADD COLUMN `critic_model` text DEFAULT 'sonnet' NOT NULL CHECK(`critic_model` IN ('sonnet','opus'));
