-- Migration 0015_fact_assertions
-- ADR 0003 slice 1: assertion modes for canon facts. Only narrated_as_fact /
-- directly_observed count as objective canon; character statements, beliefs,
-- rumors, dreams and uncertain claims are stored but never override canon.
-- Legacy rows default to narrated_as_fact — they were treated as canon.

ALTER TABLE `book_facts` ADD COLUMN `assertion_mode` text DEFAULT 'narrated_as_fact' NOT NULL CHECK(`assertion_mode` IN ('narrated_as_fact','directly_observed','stated_by_character','believed_by_character','rumor','dream_or_vision','uncertain'));
