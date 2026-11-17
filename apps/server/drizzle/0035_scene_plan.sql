-- Migration 0035_scene_plan
-- Hand-written SQL. Separate statements with the breakpoint marker
-- (see prior migrations); never put that marker inside a comment.


-- План сцен главы для локальной модели: JSON {"scenes":[...],"basedOn":число}.
ALTER TABLE chapters ADD COLUMN scene_plan TEXT;
