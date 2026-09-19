-- Migration 0026_context_manifests
-- Hand-written SQL. Separate statements with the breakpoint marker
-- (see prior migrations); never put that marker inside a comment.

-- Этап 4 ТЗ индивидуальности: манифест контекста генерации (раздел 8.1).
-- На каждую сборку контекста — какие источники вошли (версии глав, ревизии
-- героев и отношений, события знаний, стиль, outline) и что из собранного
-- поместилось в бюджет, плюс отпечаток набора источников. Критика сверяет
-- свой отпечаток с записанным при написании и говорит автору, что база
-- уехала — не блокирует: автор мог поправить героев осознанно.
--
-- Текста промпта здесь НЕТ (решение автора 2026-09-19): всё, на что
-- указывает манифест, уже версионировано, и хранить второй экземпляр правды
-- размером с промпт на каждую генерацию — рост базы без единого читателя.
CREATE TABLE context_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  -- У Writer версии ещё нет: она появится при принятии кандидата, и тогда
  -- принятие привяжет манифест к ней. У критики и правки версия известна сразу.
  chapter_version_id INTEGER REFERENCES chapter_versions(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT context_manifests_purpose_check
    CHECK (purpose IN ('writer','critique','repair'))
);--> statement-breakpoint

CREATE INDEX idx_context_manifests_version
  ON context_manifests (chapter_version_id, purpose, id);--> statement-breakpoint

CREATE INDEX idx_context_manifests_chapter
  ON context_manifests (chapter_id, purpose, id);--> statement-breakpoint

-- Кандидат прозы знает, с каким манифестом его писали, чтобы принятие
-- привязало манифест к созданной версии. SET NULL: удаление манифеста не
-- должно трогать кандидата.
ALTER TABLE prose_proposals ADD COLUMN context_manifest_id INTEGER
  REFERENCES context_manifests(id) ON DELETE SET NULL;
