-- Migration 0019_style_blend
-- Blended style profiles: a profile synthesized from two or more extracted
-- profiles rather than from a corpus of its own.
--
-- kind         — 'extracted' (fingerprint came from this profile's own corpus)
--                or 'blend' (fingerprint was synthesized from parent profiles).
-- blend_config_json — {"sources":[{"profileId":1,"weight":0.6,"emphasis":"ритм"}],
--                      "instructions":"..."}. Kept so a blend can be re-run
--                      after a parent is re-extracted, and so the UI can show
--                      provenance. Only meaningful when kind='blend'.
--
-- A blend has no corpus of its own; few-shot samples are drawn from the parents
-- at read time, which is why parents are referenced by id here rather than
-- copied. Deleting a parent leaves the blend's fingerprint intact (already
-- materialized) but drops its samples — cheaper than cascading a delete into a
-- profile the author may still have attached to a book.

ALTER TABLE `style_profiles` ADD COLUMN `kind` text DEFAULT 'extracted' NOT NULL CHECK(`kind` IN ('extracted','blend'));--> statement-breakpoint
ALTER TABLE `style_profiles` ADD COLUMN `blend_config_json` text;
