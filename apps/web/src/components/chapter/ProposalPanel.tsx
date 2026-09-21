import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { findLostMentions, type ProseChange, type ProseProposal } from "@book-forge/shared";

/** Свежее состояние главы, перечитанное по просьбе автора после 409.
 *  Возвращается вызывающей страницей, а не читается панелью: страница знает
 *  главу целиком и обязана обновить свои ожидания той же величиной. */
export interface ProposalReread {
  expectedVersionId: number | null;
  expectedDraftRevision: number | null;
  changes: ProseChange[];
}

interface Props {
  proposal: ProseProposal;
  changes: ProseChange[];
  /** Что вкладка считает текущей версией и ревизией черновика: сервер сверит
   *  это со своим состоянием и откажет, если автор смотрит на устаревшее. */
  expectedVersionId: number | null;
  expectedDraftRevision: number | null;
  /** Перечитать главу и вернуть новые ожидания. Без этого 409 — тупик:
   *  перезагрузка страницы теряла кандидата, а других выходов не было. */
  onReread?: () => Promise<ProposalReread>;
  onAccepted: (versionId: number) => void | Promise<void>;
  onRejected: () => void | Promise<void>;
  /** Слов в тексте, от которого считался кандидат (текущая версия главы). */
  baseWordCount?: number | null;
  /** Защищённые фрагменты, которых в тексте правки не нашлось (сервер, `done.protectedLost`). */
  protectedLost?: string[];
  /** Имена героев книги — для поиска пропавших упоминаний. */
  characterNames?: string[];
}

const CHANGE_LABEL: Record<ProseChange["kind"], string> = {
  replace: "Переписано",
  insert: "Добавлено",
  delete: "Убрано",
};

/** Что именно не сошлось и что с этим делать. Причину называет сервер
 *  (`details.reason`), а не догадывается вкладка по тексту сообщения. */
type Recovery =
  | { kind: "reread"; message: string }
  | { kind: "drift"; message: string }
  | { kind: "none"; message: string };

function recoveryFor(reason: string | undefined, message: string): Recovery {
  if (reason === "version" || reason === "draft") {
    return {
      kind: "reread",
      message:
        reason === "draft"
          ? "Черновик изменился, пока шла генерация. Перечитайте главу — кандидат останется на месте."
          : "Текущая версия главы изменилась. Перечитайте главу — кандидат останется на месте.",
    };
  }
  if (reason === "stale") {
    return {
      kind: "drift",
      message:
        "База, от которой считался кандидат, изменилась: план главы, её версия или материалы книги. Кандидат писался по старому.",
    };
  }
  return { kind: "none", message };
}

export function ProposalPanel({
  proposal,
  changes,
  expectedVersionId,
  expectedDraftRevision,
  onReread,
  onAccepted,
  onRejected,
  baseWordCount,
  protectedLost,
  characterNames,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  /** Чем была последняя попытка: её и повторяем, чтобы автор не выбирал
   *  абзацы заново. `undefined` — принимали целиком. */
  const lastAttemptRef = useRef<string[] | undefined>(undefined);
  // Один ключ на жизнь панели: повтор после сетевого сбоя обязан быть повтором
  // того же принятия, а не вторым принятием.
  const requestIdRef = useRef(
    `accept-${proposal.id}-${Math.random().toString(36).slice(2, 10)}`,
  );
  // Смена кандидата обнуляет всё местное состояние (С13 ревью 2026-09-19).
  // Панель переиспользуется при новом прогоне, а ключ идемпотентности,
  // выбранные абзацы и запомненная попытка оставались от прежнего: повтор
  // принятия уходил с чужим requestId и возвращал чужую версию.
  const proposalIdRef = useRef(proposal.id);
  if (proposalIdRef.current !== proposal.id) {
    proposalIdRef.current = proposal.id;
    requestIdRef.current = `accept-${proposal.id}-${Math.random().toString(36).slice(2, 10)}`;
    lastAttemptRef.current = undefined;
  }
  useEffect(() => {
    setSelected(new Set());
    setError(null);
    setRecovery(null);
    setBusy(false);
  }, [proposal.id]);

  const unconfirmed = proposal.completion === "unconfirmed";
  // С5 ревью 2026-09-19: бэкенд подписки причину остановки не сообщает
  // вовсе, и красное «Завершение не подтверждено» горело на каждой главе.
  // Тревожиться стоит лишь тогда, когда обрыв назван бэкендом или виден по
  // тексту — статус `incomplete` теперь означает именно это.
  const looksCut = proposal.status === "incomplete";
  const unknownEnding = unconfirmed && !looksCut;
  const paragraphs = useMemo(
    () => proposal.contentText.split(/\n\s*\n/).filter((p) => p.trim().length > 0),
    [proposal.contentText],
  );

  const base = baseWordCount ?? 0;
  const volumeDelta =
    base > 0 ? Math.round(((proposal.wordCount - base) / base) * 100) : null;
  // Литраб: «просили убрать повторы, а фрагмент стал на 15% короче — модель
  // убрала что-то ещё». Порог 10%, только для правки: черновик главы объёма
  // базы не обещал.
  const shrunkTooMuch =
    proposal.kind === "repair" && base > 0 && proposal.wordCount < base * 0.9;
  const lostNames = useMemo(
    () =>
      characterNames && characterNames.length > 0
        ? findLostMentions(changes, proposal.contentText, characterNames)
        : [],
    [changes, proposal.contentText, characterNames],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  interface AcceptOptions {
    selectedChangeIds?: string[];
    expectedVersionId?: number | null;
    expectedDraftRevision?: number | null;
    /** Осознанное согласие с уехавшей базой контекста — только по кнопке. */
    acknowledgeContextDrift?: boolean;
  }

  async function accept(opts: AcceptOptions = {}): Promise<void> {
    setBusy(true);
    setError(null);
    setRecovery(null);
    lastAttemptRef.current = opts.selectedChangeIds;
    try {
      const result = await api.acceptProposal(proposal.id, {
        requestId: requestIdRef.current,
        expectedVersionId:
          opts.expectedVersionId !== undefined
            ? opts.expectedVersionId
            : expectedVersionId,
        expectedDraftRevision:
          opts.expectedDraftRevision !== undefined
            ? opts.expectedDraftRevision
            : expectedDraftRevision,
        // Незавершённое завершение автор уже видит в предупреждении выше;
        // уехавшую базу — только после отказа сервера, и подтверждает
        // отдельно. Одна галочка на оба вопроса скрывала один из них.
        acknowledgeUnconfirmed: unconfirmed,
        acknowledgeContextDrift: opts.acknowledgeContextDrift ?? false,
        ...(opts.selectedChangeIds ? { selectedChangeIds: opts.selectedChangeIds } : {}),
      });
      await onAccepted(result.version.id);
    } catch (e) {
      const err = e as { status?: number; reason?: string };
      const message = e instanceof Error ? e.message : String(e);
      if (err.status === 409) {
        setRecovery(recoveryFor(err.reason, message));
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  /** Перечитать главу и повторить ту же попытку тем же requestId. Кандидат
   *  никуда не девается — в этом вся разница с перезагрузкой страницы. */
  async function rereadAndRetry(): Promise<void> {
    if (!onReread) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await onReread();
      const attempt = lastAttemptRef.current;
      if (attempt) {
        const alive = new Set(fresh.changes.map((ch) => ch.id));
        if (!attempt.every((id) => alive.has(id))) {
          // Глава уехала сильнее, чем сами правки: молча принять «то же
          // самое» уже нельзя, набор изменений другой.
          setRecovery(null);
          setSelected(new Set());
          setError(
            "Глава изменилась настолько, что прежний выбор к ней не подходит. Отметьте изменения заново.",
          );
          return;
        }
      }
      await accept({
        ...(attempt ? { selectedChangeIds: attempt } : {}),
        expectedVersionId: fresh.expectedVersionId,
        expectedDraftRevision: fresh.expectedDraftRevision,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function acceptAnyway(): Promise<void> {
    const attempt = lastAttemptRef.current;
    await accept({
      ...(attempt ? { selectedChangeIds: attempt } : {}),
      acknowledgeContextDrift: true,
    });
  }

  async function reject(): Promise<void> {
    setBusy(true);
    setError(null);
    setRecovery(null);
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
        {proposal.beatsDone !== null && proposal.beatsTotal !== null && (
          <> · написано беатов: {proposal.beatsDone} из {proposal.beatsTotal}</>
        )}
      </div>
      <p className="text-sm">
        Глава не изменена, пока вы не примете этот текст.
      </p>
      {volumeDelta !== null && (
        <p className="text-sm">
          Объём: {base} → {proposal.wordCount} слов (
          {volumeDelta >= 0 ? "+" : "−"}
          {Math.abs(volumeDelta)}%)
        </p>
      )}
      {shrunkTooMuch && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Правка убрала больше десятой части текста — проверьте, что пропало.
        </p>
      )}
      {protectedLost && protectedLost.length > 0 && (
        <div className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Защищённое не дожило:
          <ul style={{ marginLeft: 16 }}>
            {protectedLost.map((f) => (
              <li key={f}>«{f}»</li>
            ))}
          </ul>
        </div>
      )}
      {lostNames.length > 0 && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Из правленных абзацев исчезли имена: {lostNames.join(", ")}
        </p>
      )}
      {looksCut && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Похоже, текст оборван
          {proposal.stopReason === "max_tokens"
            ? ": модель упёрлась в предел длины ответа."
            : ": последняя фраза не закончена."}{" "}
          Принять его можно, но проверьте конец главы.
        </p>
      )}
      {unknownEnding && (
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          Бэкенд подписки не сообщает, дописала ли модель до конца. Текст
          выглядит законченным.
        </p>
      )}
      {proposal.stopReason === "held" && (
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          Остановлено по вашей просьбе после беата {proposal.beatsDone}. Принять можно;
          дописать оставшиеся беаты — кнопкой на странице главы после принятия.
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

      {recovery && (
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: 12,
            border: "1px solid var(--color-ink-amber-fg)",
            borderRadius: 6,
          }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-amber-fg)" }}>
            {recovery.message}
          </p>
          {recovery.kind === "reread" && onReread && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => void rereadAndRetry()} disabled={busy}>
                Перечитать главу и принять ещё раз
              </Button>
            </div>
          )}
          {recovery.kind === "drift" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => void acceptAnyway()} disabled={busy}>
                Всё равно принять
              </Button>
              {onReread && (
                <Button
                  variant="secondary"
                  onClick={() => void rereadAndRetry()}
                  disabled={busy}
                >
                  Сначала перечитать главу
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => void accept()} disabled={busy}>
          Принять целиком
        </Button>
        <Button
          variant="secondary"
          onClick={() => void accept({ selectedChangeIds: [...selected] })}
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
