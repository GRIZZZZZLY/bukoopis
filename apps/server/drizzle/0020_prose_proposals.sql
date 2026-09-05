-- Migration 0020_prose_proposals
-- Генерация главы и repair перестают быть автокоммитом: результат ложится
-- кандидатом, версию из него делает явное принятие автора.
--
-- chapter_drafts.revision — монотонный CAS-токен автосохранения. Временной
-- метки для этого мало: два автосохранения внутри одной секунды неразличимы,
-- а принятие обязано отличить «автор ничего не трогал» от «автор переписал
-- абзац, пока шла генерация».
--
-- prose_proposals.base_draft_revision — NULL значит «черновика не было вовсе»,
-- и это не то же самое, что ревизия 0: переход «черновика нет -> черновик
-- появился» тоже обязан ломать принятие.
--
-- context_fingerprint — отпечаток значимых зависимостей на старте (план главы,
-- текущая версия, время правки книги). Разошёлся к моменту принятия — автор
-- получает предупреждение и принимает осознанно, а не молча.

ALTER TABLE `chapter_drafts` ADD COLUMN `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `prose_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'streaming' NOT NULL,
	`base_version_id` integer,
	`base_draft_revision` integer,
	`context_fingerprint` text NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`content_json` text DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}' NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`completion` text DEFAULT 'unconfirmed' NOT NULL,
	`stop_reason` text,
	`model_id` text,
	`backend` text,
	`accepted_version_id` integer,
	`accept_request_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "prose_proposals_kind_check" CHECK(`kind` IN ('write','repair')),
	CONSTRAINT "prose_proposals_status_check" CHECK(`status` IN ('streaming','ready','incomplete','cancelled','failed','accepted','rejected','superseded')),
	CONSTRAINT "prose_proposals_completion_check" CHECK(`completion` IN ('confirmed','unconfirmed'))
);--> statement-breakpoint
CREATE INDEX `idx_prose_proposals_chapter` ON `prose_proposals` (`chapter_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_prose_proposals_accept_request` ON `prose_proposals` (`accept_request_id`) WHERE `accept_request_id` IS NOT NULL;
