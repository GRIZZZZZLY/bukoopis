-- Заимствования из litrab.ai (docs/superpowers/specs/2026-09-21-litrab-borrowings.md).

-- Сырые заметки автора. Единственная колонка книги, которую НЕ читает ни одна
-- сборка контекста: сюда автор кладёт то, что нельзя потерять, но не нужно
-- модели. Инвариант закреплён тестом на маячок.
ALTER TABLE `books` ADD COLUMN `author_notes` text;
--> statement-breakpoint

-- «Глазок»: герой, снятый с запросов. Читается ровно в одном месте —
-- gatherCharacterContext; планировщик и проверка состава видят его как прежде.
-- Не часть профиля: ревизия карточки от переключения не растёт.
ALTER TABLE `characters` ADD COLUMN `hidden_from_prompts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- Глава по беатам: сколько беатов кандидат уже содержит и сколько их в плане.
-- NULL у обоих — кандидат писался целиком.
ALTER TABLE `prose_proposals` ADD COLUMN `beats_done` integer;
--> statement-breakpoint
ALTER TABLE `prose_proposals` ADD COLUMN `beats_total` integer;
--> statement-breakpoint

-- Чат по книге. Тред привязан к главе: разговор идёт над открытым текстом.
-- Треды друг о друге не знают — решение принято вслед за Литрабом: дешевле, и
-- вчерашняя ошибка не едет дальше по книге.
CREATE TABLE IF NOT EXISTS `chat_threads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `book_id` integer NOT NULL REFERENCES `books`(`id`) ON DELETE cascade,
  `chapter_id` integer NOT NULL REFERENCES `chapters`(`id`) ON DELETE cascade,
  `title` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chat_threads_chapter` ON `chat_threads` (`chapter_id`, `id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` integer NOT NULL REFERENCES `chat_threads`(`id`) ON DELETE cascade,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `chat_messages_role_check` CHECK (`role` IN ('user','assistant'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chat_messages_thread` ON `chat_messages` (`thread_id`, `id`);
