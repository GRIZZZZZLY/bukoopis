-- Migration 0016_entity_aliases
-- ADR 0003 slice 2: stable entity identity for canon facts. book_facts.entity_id
-- already exists (0012, nullable) but was never populated; the server now
-- resolves entityName -> a canonical characters/locations/items row and stores
-- the id, so Russian case forms / nicknames collapse to one entity. Aliases are
-- an author-managed fallback for names the extractor can't normalize on its own.
-- `alias` is stored lowercased for case-insensitive lookup + uniqueness.

CREATE TABLE `entity_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`alias` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_aliases_type_check" CHECK(`entity_type` IN ('character','location','item'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_entity_aliases_alias` ON `entity_aliases` (`book_id`,`entity_type`,`alias`);--> statement-breakpoint
CREATE INDEX `idx_entity_aliases_entity` ON `entity_aliases` (`entity_type`,`entity_id`);
