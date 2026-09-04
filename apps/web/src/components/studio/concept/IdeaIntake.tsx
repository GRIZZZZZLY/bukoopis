interface Props {
  idea: string;
  onIdeaChange: (next: string) => void;
  onGenerate: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

export const IDEA_MIN_LENGTH = 10;

/** Единственное, что автор печатает сам. Всё дальше он читает и выбирает. */
export function IdeaIntake({ idea, onIdeaChange, onGenerate, busy, error }: Props) {
  const ready = idea.trim().length >= IDEA_MIN_LENGTH;
  return (
    <section aria-label="Задумка книги">
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Напиши своими словами, о чём книга: одной фразой или сбивчиво, как думается.
        Жанр, герой и конфликт появятся в питчах, их не нужно придумывать сейчас.
      </p>
      <textarea
        className="input"
        aria-label="О чём книга?"
        value={idea}
        onChange={(e) => onIdeaChange(e.target.value)}
        rows={5}
        style={{ width: "100%", resize: "vertical" }}
        disabled={busy}
      />
      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ready}
          onClick={() => void onGenerate()}
        >
          {busy ? "Думаем…" : "Предложить питчи"}
        </button>
      </div>
    </section>
  );
}
