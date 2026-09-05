import { useState } from "react";
import { api, type IntakeResponse } from "@/api/client";
import { DropZone } from "./DropZone";
import { IntakeSummary } from "./IntakeSummary";

interface Props {
  bookId: number;
  onIntake: () => void;
}

/** `btoa(String.fromCharCode(...new Uint8Array(buf)))` blows the call stack on
 *  any real file — the spread passes every byte as its own function argument,
 *  and that ceiling sits around 100 KB of arguments, well under one chapter's
 *  worth of .docx. `FileReader.readAsDataURL` does the base64 encoding
 *  natively, so no byte ever becomes a JS function argument; the payload is
 *  the data URL's content after its comma. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
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
      // По одному файлу, а не Promise.all: одна нечитаемая запись отбивала
      // весь пакет, и автор терял всё перетаскивание. Сервер и так живёт
      // по-файлово — клиент должен вести себя так же.
      const payload: Array<{ filename: string; content?: string; contentBase64?: string }> = [];
      const unread: Array<{ filename: string; message: string }> = [];
      for (const f of files) {
        try {
          payload.push(
            f.name.toLowerCase().endsWith(".docx")
              ? { filename: f.name, contentBase64: await fileToBase64(f) }
              : { filename: f.name, content: await f.text() },
          );
        } catch (e) {
          unread.push({
            filename: f.name,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (payload.length === 0) {
        // Звать сервер не с чем — но автору всё равно надо сказать, что именно
        // не прочиталось, теми же словами, что и про отказы сервера.
        setResult({ summary: [], ideaSet: false, chapters: [], failures: unread, revision: 0 });
        return;
      }

      const out = await api.intake(bookId, payload);
      // Нечитаемые файлы встают рядом с тем, о чём отчитался сервер: для автора
      // это один и тот же вопрос — что из брошенного не дошло.
      setResult({ ...out, failures: [...unread, ...out.failures] });
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
