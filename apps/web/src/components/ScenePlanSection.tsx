import { useEffect, useState } from "react";
import type { Chapter } from "@book-forge/shared";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { SCENE_PLAN_LABELS as L } from "@/lib/labels";
import { finishJob, startJob } from "@/lib/jobs";

interface Props {
  chapter: Chapter;
  onUpdated: () => void | Promise<void>;
}

const toTexts = (c: Pick<Chapter, "scenePlan">) =>
  (c.scenePlan?.scenes ?? []).map((s) => s.events.join("\n"));

/** Строки обрезаются, пустые и пустые сцены выпадают. */
function toScenes(texts: string[]) {
  return texts
    .map((t) => ({
      events: t
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    }))
    .filter((s) => s.events.length > 0);
}

export function ScenePlanSection({ chapter, onUpdated }: Props) {
  const [stored, setStored] = useState(chapter);
  const [texts, setTexts] = useState(() => toTexts(chapter));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Глава перечитана снаружи — берём её план.
  useEffect(() => {
    setStored(chapter);
    setTexts(toTexts(chapter));
  }, [chapter.scenePlan, chapter.scenePlanStale]); // eslint-disable-line react-hooks/exhaustive-deps

  const scenes = toScenes(texts);
  const dirty =
    JSON.stringify(scenes) !== JSON.stringify(stored.scenePlan?.scenes ?? []);

  async function run(call: () => Promise<Chapter>, job?: string) {
    setBusy(true);
    setError(null);
    const jobId = job ? startJob({ label: job }) : null;
    try {
      const next = await call();
      setStored(next);
      setTexts(toTexts(next));
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (jobId !== null) finishJob(jobId);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{L.title}</h3>
      <p className="field-hint">{L.hint}</p>
      {stored.scenePlan && stored.scenePlanStale && (
        <p className="text-sm">{L.stale}</p>
      )}
      {texts.map((t, i) => (
        <label key={i} className="flex flex-col gap-1">
          <span className="caption">{L.sceneLabel(i + 1)}</span>
          <textarea
            className="input"
            rows={Math.max(4, t.split("\n").length)}
            value={t}
            onChange={(e) =>
              setTexts((all) => all.map((x, j) => (j === i ? e.target.value : x)))
            }
          />
        </label>
      ))}
      <div className="flex gap-2">
        <Button
          onClick={() =>
            void run(() => api.generateScenePlan(chapter.id), L.jobLabel)
          }
          disabled={busy}
        >
          {busy ? L.generating : L.generate}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void run(() => api.saveScenePlan(chapter.id, { scenes }))}
          disabled={busy || !dirty}
        >
          {L.save}
        </Button>
        {stored.scenePlan && (
          <Button
            variant="secondary"
            onClick={() => void run(() => api.saveScenePlan(chapter.id, null))}
            disabled={busy}
          >
            {L.clear}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
