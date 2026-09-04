import { useState } from "react";
import { api } from "@/api/client";
import { isConceptComplete, type BookConcept, type PitchMixField } from "@book-forge/shared";
import { IdeaIntake } from "./IdeaIntake";
import { PitchBoard } from "./PitchBoard";
import { ConceptCard } from "./ConceptCard";
import type { PremiseField } from "./PremiseFieldPuzzle";

interface Props {
  bookId: number;
  concept: BookConcept;
  onConceptChange: (next: BookConcept) => void;
}

/** Этап «Замысел» целиком: задумка → питчи → утверждённый замысел. Ветвится по
 *  состоянию концепта, а не по локальному флагу, поэтому F5 возвращает туда же. */
export function ConceptStage({ bookId, concept, onConceptChange }: Props) {
  const [idea, setIdea] = useState(concept.idea ?? "");
  const [editingIdea, setEditingIdea] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [newPitchIds, setNewPitchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function saveIdeaIfChanged(nextIdea: string): Promise<BookConcept> {
    if (nextIdea === (concept.idea ?? "")) return concept;
    const saved = await api.patchConcept(bookId, { ...concept, idea: nextIdea });
    onConceptChange(saved);
    return saved;
  }

  async function generate(direction?: string) {
    await run(async () => {
      await saveIdeaIfChanged(idea.trim());
      const body = direction && direction.length > 0 ? { direction } : {};
      const out = await api.generatePitches(bookId, body);
      setQuestions(out.questions);
      setNewPitchIds(out.newPitchIds);
      setEditingIdea(false);
      onConceptChange(out.concept);
    });
  }

  async function answer(question: string, text: string) {
    const nextIdea = `${idea.trim()}\n${question} ${text}`;
    setIdea(nextIdea);
    await run(async () => {
      await saveIdeaIfChanged(nextIdea);
      const out = await api.generatePitches(bookId, {});
      setQuestions(out.questions);
      setNewPitchIds(out.newPitchIds);
      onConceptChange(out.concept);
    });
  }

  async function blend(picks: Partial<Record<PitchMixField, string>>) {
    await run(async () => {
      const out = await api.blendPitch(bookId, { picks });
      setNewPitchIds([out.pitchId]);
      onConceptChange(out.concept);
    });
  }

  async function choose(pitchId: string) {
    await run(async () => {
      onConceptChange(await api.lockConcept(bookId, pitchId));
    });
  }

  async function remove(pitchId: string) {
    await run(async () => {
      const next = { ...concept, pitches: concept.pitches.filter((p) => p.id !== pitchId) };
      onConceptChange(await api.patchConcept(bookId, next));
    });
  }

  async function saveCard(next: BookConcept) {
    const saved = await api.patchConcept(bookId, next);
    onConceptChange(saved);
  }

  async function refine(field: PremiseField, draft?: string) {
    return await api.refineConceptField(bookId, field, draft);
  }

  async function unlock() {
    await run(async () => {
      onConceptChange(await api.unlockConcept(bookId));
    });
  }

  if (isConceptComplete(concept)) {
    return <ConceptCard concept={concept} onSave={saveCard} onRefine={refine} onUnlock={unlock} busy={busy} />;
  }

  if (concept.pitches.length > 0 && !editingIdea) {
    return (
      <PitchBoard
        pitches={concept.pitches}
        newPitchIds={newPitchIds}
        questions={questions}
        busy={busy}
        error={error}
        onMore={(d) => generate(d)}
        onBlend={blend}
        onChoose={choose}
        onRemove={remove}
        onAnswer={answer}
        onBackToIdea={() => setEditingIdea(true)}
      />
    );
  }

  return <IdeaIntake idea={idea} onIdeaChange={setIdea} onGenerate={() => generate()} busy={busy} error={error} />;
}
