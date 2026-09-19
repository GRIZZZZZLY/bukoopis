-- Migration 0025_meta_summary_per_range
-- Hand-written SQL. Separate statements with the breakpoint marker
-- (see prior migrations); never put that marker inside a comment.

-- Сводка ранних глав хранилась ОДНОЙ строкой на книгу и всегда покрывала всё,
-- кроме последних трёх глав. При генерации главы 10 в книге из сорока такая
-- сводка пересказывает будущее, и брать её нельзя (AC-10) — а других нет,
-- поэтому все ранние главы уходили в промпт поглавно. На главе 35 это три
-- десятка пересказов там, где хватило бы одного.
--
-- Уникальность переносится на (book_id, covers_to_order): у книги живёт по
-- сводке на каждый пройденный рубеж, и сцена берёт ту, что кончается ДО её
-- границы. Строки накапливаются по одной на главу — это текст, а не данные,
-- и он на порядки меньше самих глав.
DROP INDEX IF EXISTS idx_book_meta_summaries_book;--> statement-breakpoint

CREATE UNIQUE INDEX idx_book_meta_summaries_range
  ON book_meta_summaries (book_id, covers_to_order);
