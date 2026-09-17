import { useEffect, useState, type FormEvent } from "react";
import {
  VOICE_SAMPLE_SITUATIONS,
  VOICE_SITUATION_LABELS,
  type Character,
  type CharacterVoiceSample,
  type VoiceSampleSituation,
} from "@book-forge/shared";
import { api } from "@/api/client";

interface Props {
  characterId: number;
  /** Для выбора адресата. Герой сам себе адресатом быть не может. */
  characters: Character[];
}

/** Банк образцов речи одного героя (ТЗ индивидуальности, раздел 5.2).
 *  Авторский образец — уже решение автора и создаётся принятым; образец
 *  модели ждёт кнопки. Отдельного экрана карточки в этом этапе нет, поэтому
 *  блок живёт во вкладке «Персонажи» панели материалов. */
export function VoiceSamples({ characterId, characters }: Props) {
  const [list, setList] = useState<CharacterVoiceSample[] | null>(null);
  const [text, setText] = useState("");
  const [situation, setSituation] = useState<VoiceSampleSituation>("neutral");
  const [addressee, setAddressee] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setList(await api.listVoiceSamples(characterId));
    } catch (e) {
      setList([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [characterId]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createVoiceSample(characterId, {
        text: text.trim(),
        situation,
        origin: "author",
        ...(addressee !== null ? { addresseeCharacterId: addressee } : {}),
      });
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: number, status: "accepted" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await api.updateVoiceSample(id, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteVoiceSample(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const nameById = new Map(characters.map((c) => [c.id, c.canonicalName]));
  const others = characters.filter((c) => c.id !== characterId);

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
          {error}
        </p>
      )}
      <form onSubmit={onAdd} className="flex flex-col gap-2">
        <textarea
          aria-label="Текст образца"
          placeholder="Одна реплика этого героя"
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
        />
        <div className="flex gap-2 flex-wrap items-center">
          <select
            aria-label="Ситуация"
            value={situation}
            onChange={(e) => setSituation(e.target.value as VoiceSampleSituation)}
            className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
          >
            {VOICE_SAMPLE_SITUATIONS.map((s) => (
              <option key={s} value={s}>
                {VOICE_SITUATION_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Собеседник"
            value={addressee ?? ""}
            onChange={(e) =>
              setAddressee(e.target.value ? Number(e.target.value) : null)
            }
            className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
          >
            <option value="">любой собеседник</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.canonicalName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)]"
          >
            Добавить образец
          </button>
        </div>
      </form>

      {list === null ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">Загрузка…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Образцов речи нет. Три коротких — обычный разговор, конфликт,
          уязвимость — дают Writer'у диапазон.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((s) => (
            <li key={s.id} className="text-sm flex items-start gap-2">
              <span className="flex-1">
                «{s.text}»{" "}
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {VOICE_SITUATION_LABELS[s.situation]}
                  {s.addresseeCharacterId !== null &&
                    ` · ${nameById.get(s.addresseeCharacterId) ?? `#${s.addresseeCharacterId}`}`}
                  {s.status === "proposed" && " · ждёт решения"}
                </span>
              </span>
              {s.status === "proposed" && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus(s.id, "accepted")}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5"
                  >
                    Принять
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus(s.id, "rejected")}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5"
                  >
                    Отклонить
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={`Удалить образец ${s.id}`}
                disabled={busy}
                onClick={() => onDelete(s.id)}
                className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
