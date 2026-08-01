import { useMemo, useState, type FormEvent } from "react";
import { api } from "@/api/client";
import type { BlendSource, StyleProfile } from "@book-forge/shared";

interface Props {
  /** All profiles; only extracted ones with a fingerprint can be blended. */
  profiles: StyleProfile[];
  onCreated: () => void;
  onCancel: () => void;
}

interface Row {
  profileId: number;
  weight: number;
  emphasis: string;
}

const MAX_SOURCES = 4;

/**
 * Builds a new style out of several existing ones. The result is a normal
 * profile — the author picks it on a book like any other; nothing downstream
 * knows it was blended.
 */
export function StyleBlendForm({ profiles, onCreated, onCancel }: Props) {
  const eligible = useMemo(
    () => profiles.filter((p) => p.fingerprint !== null),
    [profiles],
  );

  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [rows, setRows] = useState<Row[]>(() =>
    eligible.slice(0, 2).map((p) => ({
      profileId: p.id,
      weight: 50,
      emphasis: "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenIds = new Set(rows.map((r) => r.profileId));
  const unchosen = eligible.filter((p) => !chosenIds.has(p.id));
  const weightTotal = rows.reduce((a, r) => a + r.weight, 0);
  const canSubmit =
    name.trim().length > 0 && rows.length >= 2 && weightTotal > 0 && !busy;

  function setRow(index: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function addRow() {
    const next = unchosen[0];
    if (!next || rows.length >= MAX_SOURCES) return;
    setRows((prev) => [
      ...prev,
      { profileId: next.id, weight: 25, emphasis: "" },
    ]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // Server normalises; sending shares keeps the payload readable.
      const sources: BlendSource[] = rows.map((r) => ({
        profileId: r.profileId,
        weight: r.weight / weightTotal,
        emphasis: r.emphasis.trim() === "" ? null : r.emphasis.trim(),
      }));
      await api.createStyleBlend({
        name: name.trim(),
        sources,
        instructions: instructions.trim() === "" ? null : instructions.trim(),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (eligible.length < 2) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Для смеси нужны минимум два профиля с извлечённым fingerprint. Сейчас
          подходящих: {eligible.length}.
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: 12 }}
          onClick={onCancel}
        >
          Закрыть
        </button>
      </div>
    );
  }

  return (
    <form
      className="card"
      onSubmit={onSubmit}
      aria-label="Смешать стили"
      style={{ marginBottom: 16, display: "grid", gap: 14 }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 16 }}>Смешать стили</h2>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Получится новый голос, а не поочерёдное подражание источникам. Вес
          задаёт, насколько сильно источник проступает; акцент говорит, что
          именно у него взять.
        </p>
      </div>

      <label style={{ display: "grid", gap: 4 }}>
        <span className="cap muted">Название</span>
        <input
          className="input"
          autoFocus
          placeholder="Например: сухой Пехов с образностью Дяченко"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div style={{ display: "grid", gap: 10 }}>
        <span className="cap muted">Источники</span>
        {rows.map((row, i) => {
          const percent =
            weightTotal > 0 ? Math.round((row.weight / weightTotal) * 100) : 0;
          return (
            <div
              key={row.profileId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 160px 1fr auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <select
                className="input"
                value={row.profileId}
                onChange={(e) =>
                  setRow(i, { profileId: Number(e.target.value) })
                }
                aria-label={`Источник ${i + 1}`}
              >
                {eligible
                  .filter(
                    (p) => p.id === row.profileId || !chosenIds.has(p.id),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8 }}
                title="Вес источника"
              >
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={row.weight}
                  onChange={(e) =>
                    setRow(i, { weight: Number(e.target.value) })
                  }
                  aria-label={`Вес источника ${i + 1}`}
                  style={{ flex: 1 }}
                />
                <span
                  className="cap muted"
                  style={{ width: 36, textAlign: "right" }}
                >
                  {percent}%
                </span>
              </label>
              <input
                className="input"
                placeholder="Акцент: ритм, метафорика…"
                value={row.emphasis}
                onChange={(e) => setRow(i, { emphasis: e.target.value })}
                aria-label={`Акцент источника ${i + 1}`}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={rows.length <= 2}
                onClick={() =>
                  setRows((prev) => prev.filter((_, j) => j !== i))
                }
                aria-label={`Убрать источник ${i + 1}`}
              >
                ×
              </button>
            </div>
          );
        })}
        {rows.length < MAX_SOURCES && unchosen.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={addRow}
            style={{ justifySelf: "start" }}
          >
            + Ещё источник
          </button>
        )}
      </div>

      <label style={{ display: "grid", gap: 4 }}>
        <span className="cap muted">Указания (необязательно)</span>
        <textarea
          className="input"
          rows={3}
          placeholder="Что должно получиться. При противоречии с весами побеждают указания."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>

      {error && (
        <p
          role="alert"
          style={{ color: "var(--color-ink-red)", fontSize: 13, margin: 0 }}
        >
          Не получилось: {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {busy ? "Синтезирую…" : "Синтезировать стиль"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
