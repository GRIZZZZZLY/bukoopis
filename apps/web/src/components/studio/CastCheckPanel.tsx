import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import {
  CAST_CHECK_SITUATION_LABELS,
  type CastCheckReport,
  type CastCheckSituation,
} from "@book-forge/shared";

/**
 * Проверка различий состава (ТЗ 9.1). Отчёт ничего не меняет: каждое
 * направление — предложение, решает автор. Пометка «состав изменился» держит
 * главное свойство — отчёт не должен стареть молча.
 */

interface Props {
  bookId: number;
  /** Каноническое имя по номеру героя: в отчёте лежат номера. */
  names: ReadonlyMap<number, string>;
  characterCount: number;
}

function situationLabel(s: string): string {
  return CAST_CHECK_SITUATION_LABELS[s as CastCheckSituation] ?? s;
}

export function CastCheckPanel({ bookId, names, characterCount }: Props) {
  const [report, setReport] = useState<CastCheckReport | null>(null);
  const [stale, setStale] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getCastCheck(bookId)
      .then((r) => {
        if (cancelled) return;
        setReport(r.report);
        setStale(r.stale);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  async function onRun() {
    setRunning(true);
    setError(null);
    try {
      const r = await api.runCastCheck(bookId);
      setReport(r.report);
      setStale(r.stale);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Различимость состава</h3>
        <Button onClick={() => void onRun()} disabled={running || characterCount < 2}>
          {running ? "Сравниваю…" : "Проверить различия"}
        </Button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Сравнивает не прилагательные, а первый ход героя в одинаковых положениях.
        Героев не меняет — всё, что ниже, предложения.
      </p>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-ink-rust, crimson)" }}>
          {error}
        </p>
      )}

      {stale && report && (
        <p className="text-xs" style={{ color: "var(--color-ink-amber, goldenrod)" }}>
          Состав изменился после проверки — отчёт описывает прежних героев.
        </p>
      )}

      {report && report.pairs.length === 0 && (
        <p className="text-sm">Взаимозаменяемых пар не нашлось.</p>
      )}

      {report?.pairs.map((p, i) => (
        <div key={i} className="cri-card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="cri-card-title">
            {p.characterIds.map((id) => names.get(id) ?? `#${id}`).join(" ↔ ")}
          </div>
          <div className="text-sm">{p.similarity}</div>
          <div className="text-xs muted">Основание: {p.basis}</div>
          {p.situations.length > 0 && (
            <div className="text-xs muted">
              Совпадают в: {p.situations.map(situationLabel).join(", ")}
            </div>
          )}
          {p.directions.length > 0 && (
            <div className="text-xs">
              <span className="cap-upper">Можно развести:</span>
              <ul style={{ margin: "2px 0 0 14px" }}>
                {p.directions.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-xs muted">Сохранить: {p.keep}</div>
        </div>
      ))}

      {report?.notes && <p className="text-xs muted">{report.notes}</p>}
    </section>
  );
}
