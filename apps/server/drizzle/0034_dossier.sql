-- Migration 0034_dossier
-- Hand-written SQL. Separate statements with the breakpoint marker
-- (see prior migrations); never put that marker inside a comment.

-- Досье книги: свободное поле «Мир» (в промпт Writer'а, этап 1 рабочего места).
ALTER TABLE `books` ADD COLUMN `world_notes` text;
--> statement-breakpoint

-- Какой план действует у главы: тезисы, беаты или никакой. Раньше это
-- выводилось из plan_json.selectedIndex; теперь явная колонка.
ALTER TABLE `chapters` ADD COLUMN `active_plan_kind` text
  CHECK (active_plan_kind IN ('theses','beats'));
--> statement-breakpoint

-- CASE, а не AND: SQLite не обещает вычислять AND слева направо, и на битом
-- plan_json json_extract уронил бы всю миграцию.
UPDATE `chapters` SET `active_plan_kind` = 'beats'
  WHERE CASE WHEN json_valid(`plan_json`)
          THEN json_extract(`plan_json`, '$.selectedIndex') END IS NOT NULL;
