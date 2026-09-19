-- Migration 0024_meta_summary_fingerprint
-- Hand-written SQL.

-- Сводка ранних глав пропускалась по совпадению ДИАПАЗОНА, поэтому правка
-- главы внутри него сводку не обновляла и та навсегда описывала старый текст
-- (AC-11). Отпечаток описывает, из чего сводка собрана.
ALTER TABLE book_meta_summaries ADD COLUMN source_fingerprint TEXT;
