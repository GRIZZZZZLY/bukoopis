import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useDebouncedSave } from "@/lib/useDebouncedSave";

interface Props {
  bookId: number;
  initialNotes: string | null;
  /** Пауза автосохранения; тесты ставят маленькую. */
  delayMs?: number;
}

/** Сырые заметки автора — единственное поле книги, которое в запросы к
 *  модели не уходит никогда (инвариант закреплён тестом на маячок). Сюда
 *  кладут поэпизодный план, ссылки, «не забыть»: держать можно сколько
 *  угодно, объём запросов от этого не растёт. */
export function AuthorNotesPanel({ bookId, initialNotes, delayMs = 1000 }: Props) {
  const [text, setText] = useState(initialNotes ?? "");
  const { mark, setBaseline, saving, lastSavedAt } = useDebouncedSave<string>(
    async (value) => {
      await api.updateBook(bookId, { authorNotes: value.trim() ? value : null });
    },
    { delayMs },
  );

  useEffect(() => {
    setBaseline(initialNotes ?? "");
    setText(initialNotes ?? "");
  }, [bookId, initialNotes, setBaseline]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        В запросы к модели не уходит. Поэпизодный план, ссылки, «не забыть».
      </p>
      <textarea
        className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm min-h-[10rem] font-sans"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          mark(e.target.value);
        }}
        aria-label="Заметки автора"
      />
      <div className="text-xs text-[var(--color-muted-foreground)]">
        {saving ? "Сохраняется…" : lastSavedAt ? "Сохранено" : ""}
      </div>
    </div>
  );
}
