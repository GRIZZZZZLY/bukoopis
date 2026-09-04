import { useState } from "react";
import { api, type IntakeResponse } from "@/api/client";
import { DropZone } from "./DropZone";
import { IntakeSummary } from "./IntakeSummary";

interface Props {
  bookId: number;
  onIntake: () => void;
}

/** Чтение файлов и один вызов приёма. Панель ничего не решает сама: результат
 *  показывается автору, а страница перезагружает этапы. */
export function IntakePanel({ bookId, onIntake }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResponse | null>(null);

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({ filename: f.name, content: await f.text() })),
      );
      const out = await api.intake(bookId, payload);
      setResult(out);
      onIntake();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <IntakeSummary result={result} bookId={bookId} onDismiss={() => setResult(null)} />
    );
  }

  return (
    <div className="card" aria-label="Приём материалов">
      <DropZone onFiles={(f) => void handleFiles(f)} busy={busy} />
      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
