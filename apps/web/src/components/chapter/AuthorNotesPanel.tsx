import { useEffect, useRef, useState } from "react";
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
  const { mark, flushNow, setBaseline, saving, lastSavedAt } = useDebouncedSave<string>(
    async (value) => {
      await api.updateBook(bookId, { authorNotes: value.trim() ? value : null });
    },
    { delayMs },
  );

  // `ChapterPage` монтирует панель раньше, чем догружается книга
  // (`initialNotes` идёт `null`, пока `book` не пришёл), и проп меняется
  // повторно, когда книга наконец загружается. Тот же класс потери уже чинили
  // для `concept.idea` на этапе «Замысел» (см. CLAUDE.md, ConceptStage):
  // подхватываем значение с сервера, но не поверх непустого набранного текста
  // — иначе автор, начавший печатать до того, как книга догрузилась, терял
  // бы написанное молча.
  const lastKnownNotes = useRef<string | undefined>(undefined);
  useEffect(() => {
    const incoming = initialNotes ?? "";
    const previous = lastKnownNotes.current;
    if (incoming === previous) return;
    lastKnownNotes.current = incoming;
    setBaseline(incoming);
    if (previous === undefined) return; // первый рендер — текст уже равен incoming
    setText((current) =>
      current === previous || current.trim().length === 0 ? incoming : current,
    );
  }, [initialNotes, setBaseline]);

  // Отложенное сохранение ждёт `delayMs`: уйдя со страницы или переключив
  // фокус раньше, автор терял бы набранное молча. `flushNow` пересоздаётся на
  // каждый рендер (замыкание над `onSave`), поэтому для очистки при
  // размонтировании берём его через ref — иначе сработала бы версия с первого
  // рендера, а не последняя.
  const flushNowRef = useRef(flushNow);
  flushNowRef.current = flushNow;
  useEffect(() => {
    return () => {
      void flushNowRef.current();
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        В запросы к модели не уходит. Поэпизодный план, ссылки, «не забыть».
      </p>
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          mark(e.target.value);
        }}
        onBlur={() => void flushNow()}
        aria-label="Заметки автора"
      />
      <div className="text-xs text-[var(--color-muted-foreground)]">
        {saving ? "Сохраняется…" : lastSavedAt ? "Сохранено" : ""}
      </div>
    </div>
  );
}
