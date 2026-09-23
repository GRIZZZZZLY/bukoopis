import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";

interface Hit {
  chunkId: number;
  chapterId: number | null;
  chapterOrder: number | null;
  text: string;
  score: number;
  vecRank: number | null;
  ftsRank: number | null;
  chapter: { id: number; order_index: number; title: string } | null;
}

interface Props {
  bookId: number;
}

export function SearchPanel({ bookId }: Props) {
  const [q, setQ] = useState("");
  const [beforeChapter, setBeforeChapter] = useState<string>("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [vecEnabled, setVecEnabled] = useState(false);
  const [vecAvailable, setVecAvailable] = useState<boolean | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Probe sqlite-vec availability once on mount via /api/health.
  useEffect(() => {
    let cancelled = false;
    void api
      .getHealth()
      .then((h) => {
        if (!cancelled) setVecAvailable(h.vec);
      })
      .catch(() => {
        if (!cancelled) setVecAvailable(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setError(null);
    setSearching(true);
    try {
      const result = await api.search(bookId, q.trim(), {
        beforeChapter: beforeChapter ? Number(beforeChapter) : undefined,
        topK: 10,
      });
      setHits(result.hits);
      setVecEnabled(result.vecEnabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border border-[var(--color-border)] rounded-md p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="panel-title">Поиск по тексту книги</h2>
        {vecAvailable === false && (
          <span
            className="text-xs px-2 py-1 rounded bg-red-100 text-red-900 border border-red-200"
            title="sqlite-vec extension not loaded — falling back to FTS5 only"
          >
            vec отключён — только FTS5
          </span>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Запрос (имя, фраза, ключевое слово)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit" disabled={searching || !q.trim()}>
            {searching ? "…" : "Найти"}
          </Button>
        </div>
        <label className="text-xs text-[var(--color-muted-foreground)]">
          Только до главы #
          <input
            type="number"
            min={0}
            value={beforeChapter}
            onChange={(e) => setBeforeChapter(e.target.value)}
            placeholder="—"
            className="input input-sm w-16 ml-1"
          />
          &nbsp;(spoiler-фильтр; пусто = без фильтра)
        </label>
      </form>

      {error && <p className="text-sm text-red-600">Ошибка: {error}</p>}

      {hits !== null && (
        <div className="text-xs text-[var(--color-muted-foreground)]">
          Найдено: {hits.length} · vec: {vecEnabled ? "on" : "off"}
        </div>
      )}

      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-2">
          {hits.map((h) => (
            <li
              key={h.chunkId}
              className="border border-[var(--color-border)] rounded-md p-3 text-sm"
            >
              <div className="text-xs text-[var(--color-muted-foreground)] mb-1">
                {h.chapter ? (
                  <Link
                    to={`/books/${bookId}/chapters/${h.chapter.id}`}
                    className="underline"
                  >
                    Глава #{h.chapter.order_index} «{h.chapter.title}»
                  </Link>
                ) : (
                  "Без главы"
                )}
                {" · "}score: {h.score.toFixed(4)}
                {h.ftsRank !== null && ` · fts:${h.ftsRank}`}
                {h.vecRank !== null && ` · vec:${h.vecRank}`}
              </div>
              <pre className="whitespace-pre-wrap font-sans">{h.text}</pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
