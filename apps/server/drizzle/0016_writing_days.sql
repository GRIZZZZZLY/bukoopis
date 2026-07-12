-- Migration 0016_writing_days
-- Daily manual-writing ledger ("candle" goal). Counts only positive deltas
-- from PUT /chapters/:id/draft — agent-generated versions are not counted.

CREATE TABLE writing_days (
  date TEXT PRIMARY KEY,
  words_added INTEGER NOT NULL DEFAULT 0
);
