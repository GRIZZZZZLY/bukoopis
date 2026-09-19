-- Migration 0028_manual_event_dedup
-- Hand-written SQL. Separate statements with the breakpoint marker.

-- Низкое замечание ревью 2026-09-19: ручные и перенесённые события героя не
-- попадали под уникальный ключ. `source_version_id` у них NULL, а SQLite
-- считает NULL-ы различными, поэтому повтор `POST /characters/:id/knowledge`
-- заводил второе такое же знание — и Писатель получал его в карточке дважды.
--
-- Ключ считается по COALESCE: -1 не может быть id версии, поэтому все
-- записи без версии сравниваются между собой как одна группа. У записей с
-- версией поведение прежнее.
DROP INDEX IF EXISTS uq_character_events_dedup;--> statement-breakpoint

-- Дубли, накопленные до этой миграции, иначе не дали бы создать индекс.
-- Остаётся самая ранняя запись группы: она и есть та, которую автор
-- завёл первой, остальные — повторы того же нажатия.
DELETE FROM character_events WHERE id NOT IN (
  SELECT MIN(id) FROM character_events
  GROUP BY subject_character_id, kind, dedup_key,
           COALESCE(source_version_id, -1), extractor_version
);--> statement-breakpoint

CREATE UNIQUE INDEX uq_character_events_dedup
  ON character_events (subject_character_id, kind, dedup_key,
                       COALESCE(source_version_id, -1), extractor_version);
