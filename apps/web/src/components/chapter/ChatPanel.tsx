import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, streamChatMessage } from "@/api/client";
import { CHAT_TITLE_CHARS, type ChatMessage, type ChatThread } from "@book-forge/shared";

interface Props {
  chapterId: number;
}

/** Чат по книге (заимствование из litrab.ai). Видит те же материалы, что
 *  Писатель и критики, и текст открытой главы; в главу не пишет — всё, что
 *  предложит, автор вставляет руками. Треды друг о друге не знают. */
export function ChatPanel({ chapterId }: Props) {
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [buffer, setBuffer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Тред, который мы только что завели сами внутри send(): у него заведомо
  // нет истории, а сообщения (вопрос + потоковый ответ) уже ведёт сам send().
  // Без этой отметки смена activeId запускает эффект ниже, и его
  // `listChatMessages` (пустой у нового треда) приходит ПОСЛЕ уже
  // добавленных сообщений и стирает их — реплика автора и ответ исчезали.
  const skipNextLoadRef = useRef(false);

  const loadThreads = useCallback(async () => {
    try {
      const list = await api.listChatThreads(chapterId);
      setThreads(list);
      setActiveId((cur) => (cur !== null && list.some((t) => t.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setThreads([]);
    }
  }, [chapterId]);

  useEffect(() => {
    setActiveId(null);
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeId === null) {
      setMessages([]);
      return;
    }
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    let dropped = false;
    api
      .listChatMessages(activeId)
      .then((m) => {
        if (!dropped) setMessages(m);
      })
      .catch((e) => {
        if (!dropped) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      dropped = true;
    };
  }, [activeId]);

  async function send(): Promise<void> {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      let threadId = activeId;
      if (threadId === null) {
        const created = await api.createChatThread(chapterId);
        threadId = created.id;
        setThreads((prev) => [created, ...(prev ?? [])]);
        skipNextLoadRef.current = true;
        setActiveId(created.id);
      }
      const optimistic: ChatMessage = {
        id: -Date.now(),
        threadId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      setBuffer("");
      await streamChatMessage(threadId, content, {
        onChunk: (text) => setBuffer((b) => (b ?? "") + text),
        onDone: ({ message }) => {
          setMessages((m) => [...m, message]);
          setBuffer(null);
          setInput("");
          // Не перечитываем список с сервера: тред и так уже в состоянии
          // (заведён выше при первом сообщении), а рефетч уже однажды стирал
          // и activeId, и всю переписку той же гонкой, что чинит
          // skipNextLoadRef. Название треда сервер выводит из первого
          // сообщения тем же правилом (см. CHAT_TITLE_CHARS в маршруте) —
          // применяем его локально, не дожидаясь следующей перезагрузки
          // списка, иначе тред висел бы «Без названия» до перемонтирования.
          setThreads((prev) =>
            (prev ?? []).map((t) =>
              t.id === threadId && t.title === null
                ? { ...t, title: content.slice(0, CHAT_TITLE_CHARS) }
                : t,
            ),
          );
        },
        onError: (msg) => {
          setError(msg);
          setBuffer(null);
          setInput("");
          // Сервер пишет вопрос автора в базу ДО вызова модели (chat.ts) —
          // сбой не теряет текст. Раньше на ошибке снимали оптимистичный
          // пузырь и оставляли текст в поле «для повтора»: повтор писал
          // ВТОРУЮ такую же строку, и обе уходили в окно истории, которое
          // видит модель. Перечитываем тред с сервера тем же вызовом, что
          // и при смене треда, — автор видит, что вопрос уже на месте, и
          // повтор становится осознанным новым сообщением, а не дублем.
          api
            .listChatMessages(threadId)
            .then((m) => setMessages(m))
            .catch(() => {});
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuffer(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeThread(id: number): Promise<void> {
    if (!confirm("Удалить разговор?")) return;
    try {
      await api.deleteChatThread(id);
      if (activeId === id) setActiveId(null);
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  }

  if (threads === null) return <p className="text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {threads.length === 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Разговоров пока нет — задайте вопрос, тред появится сам.
          </span>
        ) : (
          <select
            className="select input-sm flex-1"
            value={activeId ?? ""}
            onChange={(e) => setActiveId(Number(e.target.value))}
            aria-label="Разговор"
          >
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title ?? "Без названия"}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="outline" onClick={() => setActiveId(null)} disabled={busy}>
          Новый разговор
        </Button>
        {activeId !== null && (
          <button
            type="button"
            aria-label="Удалить разговор"
            className="p-1 rounded hover:bg-[var(--color-muted)]"
            onClick={() => void removeThread(activeId)}
            disabled={busy}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 max-h-[40vh] overflow-auto text-sm">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "self-end max-w-[90%]" : "self-start max-w-[90%]"}
          >
            <div className="text-xs text-[var(--color-muted-foreground)]">
              {m.role === "user" ? "Вы" : "Собеседник"}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {buffer !== null && (
          <div className="self-start max-w-[90%]">
            <div className="text-xs text-[var(--color-muted-foreground)]">Собеседник · пишет…</div>
            <div className="whitespace-pre-wrap">{buffer || "…"}</div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <textarea
        className="textarea"
        placeholder="Спросить про сцену, героя, развилку… Ctrl+Enter — отправить"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        disabled={busy}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Видит материалы книги и текст этой главы. В главу не пишет.
        </span>
        <Button size="sm" onClick={() => void send()} disabled={busy || !input.trim()}>
          Отправить
        </Button>
      </div>
    </div>
  );
}
