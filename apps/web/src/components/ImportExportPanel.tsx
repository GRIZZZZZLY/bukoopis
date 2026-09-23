import { useRef, useState } from "react";
import { api, exportBookUrl } from "@/api/client";

interface ImportProps {
  bookId: number;
  onImported: () => void | Promise<void>;
}

/** Готовые главы без модели: каждый файл режется на главы по `#`, затем по
 *  «Глава N», затем по `##`; без разметки файл становится одной главой.
 *  Бесплатно — модель не зовётся. */
export function ImportChaptersPanel({ bookId, onImported }: ImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setImporting(true);
    setError(null);
    setReport(null);
    let chapters = 0;
    let words = 0;
    try {
      // По одному: сервер принимает файл за запрос, а ошибка в третьем
      // файле не должна отменять первые два.
      for (const file of files) {
        const res = await api.importBook(bookId, file.name, await file.text());
        chapters += res.created.length;
        words += res.created.reduce((s, c) => s + c.words, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (chapters > 0) {
        setReport(`Добавлено глав: ${chapters} · слов: ${words.toLocaleString("ru-RU")}`);
        await onImported();
      }
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="import-panel">
      <input
        ref={fileRef}
        type="file"
        accept=".md,.txt,.markdown"
        multiple
        hidden
        onChange={(e) => void onFiles(e)}
      />
      <button
        type="button"
        className="dropzone-lite"
        onClick={() => fileRef.current?.click()}
        disabled={importing}
      >
        <span>{importing ? "Добавляю главы…" : "Выбрать файлы на диске"}</span>
        <span className="mono faint">.md · .txt</span>
      </button>
      {report && <p className="muted" role="status">{report}</p>}
      {error && <p role="alert" className="text-err">Ошибка: {error}</p>}
      <p className="faint import-hint">
        Главы ищутся по заголовкам <code>#</code>, затем по «Глава N», затем по{" "}
        <code>##</code>. Без разметки весь файл станет одной главой с именем файла.
      </p>
    </div>
  );
}

/** Экспорт всей книги: .md и .epub. */
export function ExportLinks({ bookId }: { bookId: number }) {
  return (
    <div className="export-links">
      <a href={exportBookUrl(bookId, "md")} className="btn btn-secondary" download>
        Экспорт .md
      </a>
      <a href={exportBookUrl(bookId, "epub")} className="btn btn-secondary" download>
        Экспорт .epub
      </a>
    </div>
  );
}
