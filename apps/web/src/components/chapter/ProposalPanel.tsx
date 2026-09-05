import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { ProseChange, ProseProposal } from "@book-forge/shared";

interface Props {
  proposal: ProseProposal;
  changes: ProseChange[];
  /** Что вкладка считает текущей версией и ревизией черновика: сервер сверит
   *  это со своим состоянием и откажет, если автор смотрит на устаревшее. */
  expectedVersionId: number | null;
  expectedDraftRevision: number | null;
  onAccepted: (versionId: number) => void | Promise<void>;
  onRejected: () => void | Promise<void>;
}

const CHANGE_LABEL: Record<ProseChange["kind"], string> = {
  replace: "Переписано",
  insert: "Добавлено",
  delete: "Убрано",
};

export function ProposalPanel({
  proposal,
  changes,
  expectedVersionId,
  expectedDraftRevision,
  onAccepted,
  onRejected,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Один ключ на жизнь панели: повтор после сетевого сбоя обязан быть повтором
  // того же принятия, а не вторым принятием.
  const requestIdRef = useRef(
    `accept-${proposal.id}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const unconfirmed = proposal.completion === "unconfirmed";
  const paragraphs = useMemo(
    () => proposal.contentText.split(/\n\s*\n/).filter((p) => p.trim().length > 0),
    [proposal.contentText],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function accept(selectedChangeIds?: string[]): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.acceptProposal(proposal.id, {
        requestId: requestIdRef.current,
        expectedVersionId,
        expectedDraftRevision,
        acknowledgeStale: unconfirmed,
        ...(selectedChangeIds ? { selectedChangeIds } : {}),
      });
      await onAccepted(result.version.id);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(
        status === 409
          ? "Текст главы изменился, пока шла генерация. Перечитайте главу и примите ещё раз."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.rejectProposal(proposal.id);
      await onRejected();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
      <div className="caption">
        {proposal.kind === "write" ? "Черновик главы" : "Исправленный текст"} ·{" "}
        {proposal.wordCount} слов
      </div>
      <p className="text-sm">
        Глава не изменена, пока вы не примете этот текст.
      </p>
      {unconfirmed && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Завершение не подтверждено
          {proposal.stopReason === "max_tokens"
            ? ": модель упёрлась в предел длины ответа."
            : ": модель не сообщила, дописала ли она до конца."}{" "}
          Текст можно посмотреть и принять, но проверьте конец главы.
        </p>
      )}

      <div style={{ maxHeight: 320, overflow: "auto" }}>
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm" style={{ marginBottom: 8 }}>
            {p}
          </p>
        ))}
      </div>

      {changes.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="caption">Что меняется</div>
          {changes.map((ch) => (
            <label key={ch.id} className="text-sm" style={{ display: "flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={selected.has(ch.id)}
                onChange={() => toggle(ch.id)}
                disabled={busy}
                aria-label={`${CHANGE_LABEL[ch.kind]}: ${
                  ch.candidateText.join(" ") || ch.baseText.join(" ")
                }`}
              />
              <span>
                <strong>{CHANGE_LABEL[ch.kind]}. </strong>
                {ch.baseText.length > 0 && (
                  <s style={{ opacity: 0.7 }}>{ch.baseText.join(" ")}</s>
                )}{" "}
                {ch.candidateText.join(" ")}
              </span>
            </label>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => void accept()} disabled={busy}>
          Принять целиком
        </Button>
        <Button
          variant="secondary"
          onClick={() => void accept([...selected])}
          disabled={busy || selected.size === 0}
        >
          Принять выбранное
        </Button>
        <Button variant="destructive" onClick={() => void reject()} disabled={busy}>
          Отклонить
        </Button>
      </div>
    </section>
  );
}
