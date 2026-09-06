import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import {
  isConceptComplete,
  PITCH_FIELD_LABELS,
  type BookConcept,
  type PitchMixField,
} from "@book-forge/shared";
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

  // Задумка может прийти извне: приём материалов заполняет `concept.idea` на
  // сервере, страница перечитывает концепт — а поле продолжало показывать то,
  // что было при монтировании (пустоту), и автор видел «замысел не
  // импортировался», хотя он лежал в базе. Подхватываем новое значение, но
  // никогда не затираем то, что автор печатает прямо сейчас.
  const lastKnownIdea = useRef(concept.idea ?? "");
  useEffect(() => {
    const incoming = concept.idea ?? "";
    const previous = lastKnownIdea.current;
    if (incoming === previous) return;
    lastKnownIdea.current = incoming;
    if (editingIdea) return;
    // Несохранённый набранный текст важнее пришедшего: перетираем поле только
    // если автор его не трогал (оно совпадает с прошлым значением с сервера)
    // или оставил пустым.
    setIdea((current) =>
      current === previous || current.trim().length === 0 ? incoming : current,
    );
  }, [concept.idea, editingIdea]);

  async function run<T>(
    fn: () => Promise<T>,
    options?: { rethrow?: boolean },
  ): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (options?.rethrow) throw e;
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

  async function generate(direction?: string): Promise<boolean> {
    const ok = await run(async () => {
      await saveIdeaIfChanged(idea.trim());
      const body = direction && direction.length > 0 ? { direction } : {};
      const out = await api.generatePitches(bookId, body);
      setQuestions(out.questions);
      setNewPitchIds(out.newPitchIds);
      setEditingIdea(false);
      onConceptChange(out.concept);
      return true;
    });
    return ok === true;
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
    // ConceptCard owns the visible error for this action (it renders while
    // locked; ConceptStage's own `error` only reaches IdeaIntake/PitchBoard),
    // so a failure has to reach its catch — rethrow after recording it here.
    await run(async () => {
      onConceptChange(await api.unlockConcept(bookId));
    }, { rethrow: true });
  }

  async function lockAsIs() {
    await run(async () => {
      onConceptChange(await api.lockConcept(bookId));
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

  // Bridge for books created before this branch: a premise typed straight into
  // the old form, no pitches to show. One click confirms it as-is; the author
  // can still choose to start over with pitches instead.
  const legacyLogline = (concept.premise.logline ?? "").trim();
  if (legacyLogline.length > 0 && !editingIdea) {
    return (
      <LegacyConceptBridge
        concept={concept}
        busy={busy}
        error={error}
        onLockAsIs={lockAsIs}
        onStartOver={() => setEditingIdea(true)}
      />
    );
  }

  return (
    <IdeaIntake
      idea={idea}
      onIdeaChange={setIdea}
      onGenerate={async () => {
        await generate();
      }}
      busy={busy}
      error={error}
    />
  );
}

const BRIDGE_FIELDS: PremiseField[] = ["logline", "protagonist", "conflict", "stakes"];

interface LegacyConceptBridgeProps {
  concept: BookConcept;
  busy: boolean;
  error: string | null;
  onLockAsIs: () => Promise<void>;
  onStartOver: () => void;
}

/** Read-only view of a premise typed before this branch existed. Not a fourth
 *  first-class screen — just a bridge with two exits. */
function LegacyConceptBridge({ concept, busy, error, onLockAsIs, onStartOver }: LegacyConceptBridgeProps) {
  return (
    <section className="concept-lines" aria-label="Ранее сохранённый замысел">
      <p className="muted" style={{ fontSize: 13 }}>
        Раньше уже была записана задумка. Утвердить её как есть — или начать заново с питчей.
      </p>
      {BRIDGE_FIELDS.map((field) => {
        const value = concept.premise[field] ?? "";
        if (!value) return null;
        return (
          <div key={field} className="flex flex-col gap-1 text-sm">
            <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {PITCH_FIELD_LABELS[field]}
            </span>
            <p style={{ margin: 0 }}>{value}</p>
          </div>
        );
      })}
      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onLockAsIs()}>
          {busy ? "Утверждаем…" : "Утвердить как есть"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onStartOver}>
          Начать заново с питчей
        </button>
      </div>
    </section>
  );
}
