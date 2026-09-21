import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { streamInlineCommand } from "@/api/client";
import {
  INLINE_COMMAND_LABELS,
  INLINE_COMMANDS_REQUIRING_SELECTION,
  SENSE_CHANNEL_LABELS,
  senseChannelSchema,
  type InlineCommand,
  type SenseChannel,
} from "@book-forge/shared";

interface Props {
  editor: Editor | null;
  chapterId: number;
}

const COMMANDS: InlineCommand[] = [
  "continue",
  "rewrite",
  "shorten",
  "intensify",
  "lengthen",
];

const CONTEXT_RADIUS = 800; // chars before/after selection used as context

interface ActiveSuggestion {
  command: InlineCommand;
  selectionFrom: number;
  selectionTo: number;
  selectionText: string | null;
  beforeText: string;
  afterText: string;
  guidance: string;
  sense: SenseChannel | null;
  buffer: string;
  streaming: boolean;
  done: boolean;
  error: string | null;
}

export function InlineCommandPanel({ editor, chapterId }: Props) {
  const [hasSelection, setHasSelection] = useState(false);
  const [active, setActive] = useState<ActiveSuggestion | null>(null);
  const [guidance, setGuidance] = useState("");
  const [senseOpen, setSenseOpen] = useState(false);
  // Куда вставлять результат. Позиции запоминаются на старте команды, а
  // модель пишет десятки секунд, и автор всё это время правит текст выше:
  // по исходным позициям вставка ложилась мимо и затирала чужой абзац
  // (С13 ревью 2026-09-19). ProseMirror умеет переносить позицию через
  // изменения — `tr.mapping.map`; этим и пользуемся.
  const targetRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (pos: number) => number } } }) => {
      const target = targetRef.current;
      if (target === null || !transaction.docChanged) return;
      targetRef.current = {
        from: transaction.mapping.map(target.from),
        to: transaction.mapping.map(target.to),
      };
    };
    editor.on("transaction", onTransaction as never);
    return () => {
      editor.off("transaction", onTransaction as never);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      setHasSelection(from !== to);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const buildPayload = useCallback(
    (
      command: InlineCommand,
    ):
      | {
          selectionFrom: number;
          selectionTo: number;
          selectionText: string | null;
          beforeText: string;
          afterText: string;
        }
      | null => {
      if (!editor) return null;
      const { from, to } = editor.state.selection;
      const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n\n");
      const startOffset = editor.state.doc.textBetween(0, from, "\n\n").length;
      const endOffset = editor.state.doc.textBetween(0, to, "\n\n").length;
      const selectionText = from === to ? null : fullText.slice(startOffset, endOffset);
      const beforeText = fullText.slice(Math.max(0, startOffset - CONTEXT_RADIUS), startOffset);
      const afterText = fullText.slice(endOffset, endOffset + CONTEXT_RADIUS);

      if (
        INLINE_COMMANDS_REQUIRING_SELECTION.includes(command) &&
        (!selectionText || selectionText.trim().length === 0)
      ) {
        return null;
      }
      return {
        selectionFrom: from,
        selectionTo: to,
        selectionText,
        beforeText,
        afterText,
      };
    },
    [editor],
  );

  async function runCommand(
    command: InlineCommand,
    prevGuidance?: string,
    sense: SenseChannel | null = null,
  ) {
    if (!editor) return;
    const payload = buildPayload(command);
    if (!payload) return;
    const g = prevGuidance ?? guidance;
    targetRef.current = { from: payload.selectionFrom, to: payload.selectionTo };
    setActive({
      command,
      ...payload,
      guidance: g,
      sense,
      buffer: "",
      streaming: true,
      done: false,
      error: null,
    });
    try {
      await streamInlineCommand(
        chapterId,
        {
          command,
          selectionText: payload.selectionText,
          beforeText: payload.beforeText,
          afterText: payload.afterText,
          guidance: g.trim() || null,
          ...(sense ? { sense } : {}),
        },
        {
          onChunk: (text) =>
            setActive((a) =>
              a ? { ...a, buffer: a.buffer + text } : a,
            ),
          onDone: () =>
            setActive((a) => (a ? { ...a, streaming: false, done: true } : a)),
          onError: (message) =>
            setActive((a) =>
              a ? { ...a, streaming: false, error: message } : a,
            ),
        },
      );
    } catch (e) {
      setActive((a) =>
        a
          ? {
              ...a,
              streaming: false,
              error: e instanceof Error ? e.message : String(e),
            }
          : a,
      );
    }
  }

  function accept() {
    if (!editor || !active) return;
    const text = active.buffer.trim();
    if (!text) return;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const nodes = paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    }));
    // Позиции, перенесённые через все правки, сделанные пока модель писала.
    const target = targetRef.current ?? {
      from: active.selectionFrom,
      to: active.selectionTo,
    };
    const docSize = editor.state.doc.content.size;
    const from = Math.min(Math.max(target.from, 0), docSize);
    const to = Math.min(Math.max(target.to, from), docSize);
    editor.chain().focus().insertContentAt({ from, to }, nodes).run();
    targetRef.current = null;
    setActive(null);
    setGuidance("");
  }

  function reject() {
    targetRef.current = null;
    setActive(null);
  }

  function regenerate() {
    if (!active) return;
    void runCommand(active.command, active.guidance, active.sense);
  }

  return (
    <div className="flex flex-col gap-2 border border-[var(--color-border)] rounded-md p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium">Inline-команды (Sonnet/Opus)</div>
        <div className="text-xs text-[var(--color-muted-foreground)]">
          {hasSelection ? "Выделение есть" : "Курсор — доступна только «Продолжить»"}
        </div>
      </div>
      <input
        type="text"
        className="border border-[var(--color-input)] rounded-md px-3 py-1 text-sm"
        placeholder="Опц. указание агенту (например: «жёстче, без диалога»)"
        value={guidance}
        onChange={(e) => setGuidance(e.target.value)}
        disabled={active !== null && active.streaming}
      />
      <div className="flex gap-2 flex-wrap">
        {COMMANDS.map((cmd) => {
          const needsSel = INLINE_COMMANDS_REQUIRING_SELECTION.includes(cmd);
          const disabled =
            !editor ||
            (active !== null && active.streaming) ||
            (needsSel && !hasSelection);
          return (
            <Button
              key={cmd}
              size="sm"
              variant="outline"
              onClick={() => runCommand(cmd)}
              disabled={disabled}
            >
              {INLINE_COMMAND_LABELS[cmd]}
            </Button>
          );
        })}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Button
          size="sm"
          variant={senseOpen ? "default" : "outline"}
          onClick={() => setSenseOpen((v) => !v)}
          disabled={!editor || (active !== null && active.streaming) || !hasSelection}
          aria-expanded={senseOpen}
        >
          Описать
        </Button>
        {senseOpen &&
          senseChannelSchema.options.map((s) => (
            <Button
              key={s}
              size="sm"
              variant="ghost"
              onClick={() => {
                setSenseOpen(false);
                void runCommand("describe", undefined, s);
              }}
              disabled={!editor || (active !== null && active.streaming) || !hasSelection}
            >
              {SENSE_CHANNEL_LABELS[s]}
            </Button>
          ))}
        {senseOpen && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Одна деталь выбранного канала; фраза остаётся вашей.
          </span>
        )}
      </div>

      {active && (
        <div className="border border-[var(--color-ring)] rounded-md p-3 bg-[var(--color-muted)] flex flex-col gap-2">
          <div className="text-xs text-[var(--color-muted-foreground)]">
            Команда: <strong>{INLINE_COMMAND_LABELS[active.command]}</strong>
            {active.sense && <span> · {SENSE_CHANNEL_LABELS[active.sense]}</span>}
            {active.selectionText && (
              <span>
                {" · выделение: "}
                {active.selectionText.length} симв.
              </span>
            )}
            {active.streaming && " · стримит…"}
            {active.error && (
              <span className="text-red-600"> · ошибка</span>
            )}
          </div>

          {active.selectionText && (
            <details className="text-xs">
              <summary className="cursor-pointer">Оригинал</summary>
              <pre className="whitespace-pre-wrap mt-1 opacity-70">
                {active.selectionText}
              </pre>
            </details>
          )}

          <div className="border border-[var(--color-border)] rounded-md p-2 bg-[var(--color-background)] max-h-[300px] overflow-auto">
            <pre className="whitespace-pre-wrap text-sm font-sans">
              {active.buffer || (active.streaming ? "…" : "(пусто)")}
            </pre>
          </div>

          {active.error && (
            <p className="text-sm text-red-600">Ошибка: {active.error}</p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={accept}
              disabled={active.streaming || !active.buffer.trim()}
            >
              Принять
            </Button>
            <Button
              onClick={regenerate}
              disabled={active.streaming}
              variant="secondary"
            >
              Перегенерировать
            </Button>
            <Button
              onClick={reject}
              disabled={active.streaming}
              variant="outline"
            >
              Отклонить
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
