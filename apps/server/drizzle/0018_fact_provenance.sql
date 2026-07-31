-- Migration 0018_fact_provenance
-- Separates "where did this row come from" and "has the author vetted it" from
-- assertion_mode, which describes epistemic status INSIDE the fiction (narrated
-- as fact vs. rumor). A fact the extractor inferred from prose is not the same
-- kind of thing as one the author typed: "Илья снова не смог зажечь огонь" can
-- become "Илья не владеет магией" when the real cause was a wet amulet.
--
-- source_kind   — who produced the row.
-- review_status — whether a human vetted it. 'rejected' rows are never served
--                 to agents; 'disputed' is reserved for the review UI and is
--                 still served (it flags a conflict, not a verdict).
--
-- Legacy rows default to llm_extraction / unreviewed: every existing row came
-- from canon_fact_extractor and none has been reviewed by anyone.

ALTER TABLE `book_facts` ADD COLUMN `source_kind` text DEFAULT 'llm_extraction' NOT NULL CHECK(`source_kind` IN ('llm_extraction','manual','accepted_studio','imported_document'));--> statement-breakpoint
ALTER TABLE `book_facts` ADD COLUMN `review_status` text DEFAULT 'unreviewed' NOT NULL CHECK(`review_status` IN ('unreviewed','confirmed','disputed','rejected'));--> statement-breakpoint
CREATE INDEX `idx_book_facts_review` ON `book_facts` (`book_id`,`review_status`);
