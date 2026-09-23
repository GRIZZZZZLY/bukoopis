import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { SceneState, SceneStatePersonLine } from "@book-forge/shared";

/**
 * Анкета непрерывности на конец главы: где герои остались, что при них, что
 * осталось незакрытым. Её считает фоновое задание после принятия версии, а в
 * промпт следующей главы она уходит исходной обстановкой сцены.
 *
 * Правка автора сильнее машинной: строка помечается авторской, и запоздавший
 * разбор её не затирает. «Пересчитать» — единственный способ заказать
 * машинную анкету поверх авторской, и он снимает её осознанно.
 */

interface Props {
  chapterId: number;
}

type TextKey = "place" | "timeMarker";
type ListKey = "present" | "surroundings" | "loose" | "changes";
type PersonKey = "appearance" | "carried" | "condition";

const TEXT_LABELS: Record<TextKey, string> = {
  place: "Место",
  timeMarker: "Время",
};
const LIST_LABELS: Record<ListKey, string> = {
  present: "Кто на месте",
  surroundings: "Вокруг",
  loose: "Осталось незакрытым",
  changes: "Изменилось за главу",
};
const PERSON_LABELS: Record<PersonKey, string> = {
  appearance: "Вид и одежда",
  carried: "При себе",
  condition: "Состояние",
};

const TEXT_KEYS = Object.keys(TEXT_LABELS) as TextKey[];
const LIST_KEYS = Object.keys(LIST_LABELS) as ListKey[];
const PERSON_KEYS = Object.keys(PERSON_LABELS) as PersonKey[];

/** Правка ведётся сырым текстом, а не разобранной анкетой: разбирать на
 *  каждое нажатие клавиши значит стирать пробел, который автор только что
 *  напечатал, — поле нормализуется прямо под курсором. Разбор идёт один раз,
 *  при сохранении. */
type DraftText = Record<TextKey | ListKey | PersonKey, string>;

function toDraftText(state: SceneState | null): DraftText {
  const s = state;
  return {
    place: s?.place ?? "",
    timeMarker: s?.timeMarker ?? "",
    present: (s?.present ?? []).join("\n"),
    surroundings: (s?.surroundings ?? []).join("\n"),
    loose: (s?.loose ?? []).join("\n"),
    changes: (s?.changes ?? []).join("\n"),
    appearance: peopleToLines(s?.appearance ?? []),
    carried: peopleToLines(s?.carried ?? []),
    condition: peopleToLines(s?.condition ?? []),
  };
}

function fromDraftText(d: DraftText): SceneState {
  return {
    place: d.place.trim() ? d.place.trim() : null,
    timeMarker: d.timeMarker.trim() ? d.timeMarker.trim() : null,
    present: linesToList(d.present),
    appearance: linesToPeople(d.appearance),
    carried: linesToPeople(d.carried),
    condition: linesToPeople(d.condition),
    surroundings: linesToList(d.surroundings),
    loose: linesToList(d.loose),
    changes: linesToList(d.changes),
  };
}

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** «Нина: ключ от склада» — строка на героя. Двоеточия нет — строка теряется
 *  молча, поэтому весь остаток идёт в значение при пустом имени. */
function linesToPeople(text: string): SceneStatePersonLine[] {
  return linesToList(text).map((line) => {
    const at = line.indexOf(":");
    if (at < 0) return { name: "", value: line };
    return { name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
  });
}

function peopleToLines(items: readonly SceneStatePersonLine[]): string {
  return items.map((p) => `${p.name}: ${p.value}`).join("\n");
}

export function SceneStatePanel({ chapterId }: Props) {
  const [state, setState] = useState<SceneState | null>(null);
  const [origin, setOrigin] = useState<"llm" | "manual" | null>(null);
  const [carry, setCarry] = useState<SceneState | null>(null);
  /** Что автор видит сейчас: сохранение сверяется с этим, чтобы не лечь на
   *  чужую правку или на версию главы, которой он не читал (F23). */
  const [seen, setSeen] = useState<{ versionId: number; updatedAt: string | null } | null>(null);
  const [draft, setDraft] = useState<DraftText | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.getSceneState(chapterId);
    setState(r.state);
    setOrigin(r.origin);
    setCarry(r.carry?.state ?? null);
    setSeen(r.versionId !== null ? { versionId: r.versionId, updatedAt: r.updatedAt } : null);
  }, [chapterId]);

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setNotice(null);
    api
      .getSceneState(chapterId)
      .then((r) => {
        if (cancelled) return;
        setState(r.state);
        setOrigin(r.origin);
        setCarry(r.carry?.state ?? null);
        setSeen(r.versionId !== null ? { versionId: r.versionId, updatedAt: r.updatedAt } : null);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [chapterId]);

  async function recompute(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.recomputeSceneState(chapterId);
      setState(null);
      setOrigin(null);
      setNotice("Считается. Обновите через минуту.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Перенос правки с прежней версии главы. Не в редактор, а сразу записью:
   *  автор уже один раз согласился с этими словами. Дальше правится как своя. */
  async function carryOver(): Promise<void> {
    if (!carry || !seen) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveSceneState(chapterId, carry, seen);
      await load();
      setNotice("Ваша правка перенесена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!draft || !seen) return;
    setBusy(true);
    setError(null);
    try {
      // На 409 форма остаётся открытой с текстом автора: сообщение сервера
      // говорит, что делать, а набранное не пропадает.
      await api.saveSceneState(chapterId, fromDraftText(draft), seen);
      setDraft(null);
      await load();
      setNotice("Сохранено.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = draft;
  const hasAnything =
    state !== null &&
    (TEXT_KEYS.some((k) => (state[k] ?? "").trim().length > 0) ||
      LIST_KEYS.some((k) => state[k].length > 0) ||
      PERSON_KEYS.some((k) => state[k].length > 0));

  return (
    <section className="panel-block">
      <header className="flex items-center justify-between gap-2">
        <h3 className="panel-title">Состояние на конец главы</h3>
        <div className="flex gap-1">
          {shown === null ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setDraft(toDraftText(state))}
              >
                Править
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={recompute}>
                Пересчитать
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                Отмена
              </Button>
              <Button size="sm" disabled={busy} onClick={save}>
                Сохранить
              </Button>
            </>
          )}
        </div>
      </header>

      {error && <p className="text-sm text-[var(--danger,#b4443a)]">{error}</p>}
      {notice && !error && <p className="text-sm opacity-70">{notice}</p>}

      {shown === null && carry && (
        <div className="flex flex-col items-start gap-1 text-sm opacity-80">
          <p>
            На прежней версии главы анкету правили вы. Текст с тех пор
            переписан — машина считает анкету заново, вашу правку можно
            перенести.
          </p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={carryOver}>
            Перенести мою правку
          </Button>
        </div>
      )}

      {shown === null ? (
        hasAnything && state ? (
          <div className="flex flex-col gap-2 text-sm">
            {origin === "manual" && <p className="opacity-60">Правлено вами.</p>}
            {TEXT_KEYS.filter((k) => (state[k] ?? "").trim().length > 0).map((k) => (
              <p key={k}>
                <span className="opacity-60">{TEXT_LABELS[k]}: </span>
                {state[k]}
              </p>
            ))}
            {PERSON_KEYS.filter((k) => state[k].length > 0).map((k) => (
              <div key={k}>
                <span className="opacity-60">{PERSON_LABELS[k]}</span>
                <ul>
                  {state[k].map((p, i) => (
                    <li key={`${p.name}-${i}`}>
                      {p.name}: {p.value}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {LIST_KEYS.filter((k) => state[k].length > 0).map((k) => (
              <div key={k}>
                <span className="opacity-60">{LIST_LABELS[k]}</span>
                <ul>
                  {state[k].map((line, i) => (
                    <li key={`${line}-${i}`}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm opacity-70">
            Анкеты нет. Она появляется после того, как глава принята и разобрана.
          </p>
        )
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {TEXT_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="opacity-60">{TEXT_LABELS[k]}</span>
              <input
                className="input input-sm"
                value={shown[k]}
                onChange={(e) => setDraft({ ...shown, [k]: e.target.value })}
              />
            </label>
          ))}
          {PERSON_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="opacity-60">{PERSON_LABELS[k]} — строка «Имя: что»</span>
              <textarea
                rows={2}
                className="textarea"
                value={shown[k]}
                onChange={(e) => setDraft({ ...shown, [k]: e.target.value })}
              />
            </label>
          ))}
          {LIST_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="opacity-60">{LIST_LABELS[k]} — по строке на пункт</span>
              <textarea
                rows={2}
                className="textarea"
                value={shown[k]}
                onChange={(e) => setDraft({ ...shown, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
