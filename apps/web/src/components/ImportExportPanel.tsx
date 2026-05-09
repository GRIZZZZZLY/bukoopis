import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, exportBookUrl } from "@/api/client";

interface Props {
  bookId: number;
  onImported: () => void | Promise<void>;
}

export function ImportExportPanel({ bookId, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  async function onPickFile() {
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setReport(null);
    try {
      const content = await file.text();
      const res = await api.importBook(bookId, file.name, content);
      setReport(
        `Импортировано глав: ${res.created.length} (всего слов: ${res.created.reduce(
          (s, c) => s + c.words,
          0,
        )})`,
      );
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="flex flex-col gap-3 border border-[var(--color-border)] rounded-md p-4">
      <h2 className="text-xl font-semibold">Импорт / Экспорт</h2>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".md,.txt,.markdown"
          className="hidden"
          onChange={onFile}
        />
        <Button onClick={onPickFile} disabled={importing}>
          {importing ? "Импорт…" : "Импортировать .md/.txt"}
        </Button>
        <a
          href={exportBookUrl(bookId, "md")}
          className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-[var(--color-input)] text-sm hover:bg-[var(--color-accent)]"
          download
        >
          Скачать .md
        </a>
        <a
          href={exportBookUrl(bookId, "epub")}
          className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-[var(--color-input)] text-sm hover:bg-[var(--color-accent)]"
          download
        >
          Скачать .epub
        </a>
      </div>
      {report && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {report}
        </p>
      )}
      {error && <p className="text-sm text-red-600">Ошибка: {error}</p>}
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Импорт ищет главы по: <code>#</code> (markdown H1), затем «Глава N», затем{" "}
        <code>##</code>. Если ничего не найдено — весь файл становится одной
        главой с именем файла.
      </p>
    </section>
  );
}
