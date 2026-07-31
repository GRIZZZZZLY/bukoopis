import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, streamRepair } from "@/api/client";
import {
  CRITIC_LABELS,
  SEVERITY_LABELS,
  REPAIR_MAX_ITERATIONS,
  type CritiqueReport,
  type CriticReport,
  type CriticType,
  type IssueSeverity,
} from "@book-forge/shared";

interface Props {
  versionId: number | null;
  onRepairDone?: () => void | Promise<void>;
}

const ALL_CRITICS: CriticType[] = ["canon", "style", "editor", "reader"];

const SEVERITY_DOT: Record<IssueSeverity, string> = {
  blocking: "sev-red",
  suggestion: "sev-amber",
  nit: "sev-blue",
};

export function CritiquePanel({ versionId, onRepairDone }: Props) {
  const [report, setReport] = useState<CritiqueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [enabled, setEnabled] = useState<Set<CriticType>>(
    new Set(ALL_CRITICS),
  );
  const [error, setError] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairBuffer, setRepairBuffer] = useState("");
  const [repairIteration, setRepairIteration] = useState<{
    current: number;
    max: number;
  } | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Set<IssueSeverity>>(
    new Set<IssueSeverity>(["blocking", "suggestion"]),
  );

  async function load() {
    if (versionId === null) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await api.getCritique(versionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  async function onRun() {
    if (versionId === null) return;
    setRunning(true);
    setError(null);
    try {
      const critics = enabled.size === 4 ? undefined : [...enabled];
      const r = await api.runCritique(versionId, critics);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function toggleCritic(c: CriticType) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      if (next.size === 0) next.add(c); // никогда полностью пустой
      return next;
    });
  }

  function toggleSeverity(s: IssueSeverity) {
    setSeverityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      if (next.size === 0) next.add(s);
      return next;
    });
  }

  async function onRepair() {
    if (versionId === null) return;
    setRepairing(true);
    setRepairBuffer("");
    setRepairError(null);
    setRepairIteration(null);
    try {
      const severities =
        severityFilter.size === 3 ? undefined : [...severityFilter];
      await streamRepair(versionId, severities, {
        onIteration: (current, max) =>
          setRepairIteration({ current, max }),
        onChunk: (text) => setRepairBuffer((b) => b + text),
        onDone: async () => {
          setRepairing(false);
          if (onRepairDone) await onRepairDone();
        },
        onError: (msg) => {
          setRepairError(msg);
          setRepairing(false);
        },
      });
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : String(e));
      setRepairing(false);
    }
  }

  if (versionId === null) {
    return (
      <section className="cri-card-stack text-sm text-[var(--color-muted-foreground)]">
        Сохраните версию, чтобы запустить критику.
      </section>
    );
  }

  return (
    <section className="cri-card-stack">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">Критика версии</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {ALL_CRITICS.map((c) => (
            <label key={c} className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={enabled.has(c)}
                onChange={() => toggleCritic(c)}
              />
              {CRITIC_LABELS[c]}
            </label>
          ))}
          <Button onClick={onRun} disabled={running}>
            {running ? "Анализ…" : "Запустить критику"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--color-ink-red)]">Ошибка: {error}</p>}
      {loading && <p className="text-sm">Загрузка…</p>}

      {!loading && !report && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Критика ещё не запускалась для этой версии.
        </p>
      )}

      {report && report.status === "error" && !report.report && (
        <p className="text-sm text-[var(--color-ink-red)]">
          Все критики упали: {report.errorMessage}
        </p>
      )}

      {report && report.report && (
        <CritiqueResults report={report} />
      )}

      {report &&
        report.report &&
        (report.report.blockingCount + report.report.suggestionCount > 0 ||
          repairing ||
          repairBuffer ||
          repairError) && (
          <div className="border border-[var(--color-border)] rounded-md p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-medium">Self-repair</div>
              <div className="flex items-center gap-2 flex-wrap">
                {(["blocking", "suggestion", "nit"] as IssueSeverity[]).map(
                  (s) => (
                    <label key={s} className="text-xs flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={severityFilter.has(s)}
                        onChange={() => toggleSeverity(s)}
                        disabled={repairing}
                      />
                      {SEVERITY_LABELS[s]}
                    </label>
                  ),
                )}
                <Button onClick={onRepair} disabled={repairing}>
                  {repairing ? "Reviser пишет…" : "Запустить self-repair"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Reviser перепишет главу с приоритетом по выбранным severity.
              Создаст новую версию-ветку (parent = текущая, branch_label = repair-N).
              Лимит итераций: {REPAIR_MAX_ITERATIONS}.
            </p>
            {repairIteration && (
              <p className="text-xs">
                Итерация {repairIteration.current} / {repairIteration.max}
              </p>
            )}
            {repairError && (
              <p className="text-sm text-[var(--color-ink-red)]">Ошибка: {repairError}</p>
            )}
            {repairing && repairBuffer && (
              <div className="border border-[var(--color-ring)] rounded-md p-3 bg-[var(--color-muted)] max-h-[300px] overflow-auto">
                <div className="text-xs text-[var(--color-muted-foreground)] mb-2">
                  Live stream (Reviser пишет, после завершения сохранится как новая версия):
                </div>
                <pre className="whitespace-pre-wrap text-sm font-sans">
                  {repairBuffer}
                </pre>
              </div>
            )}
          </div>
        )}
    </section>
  );
}

function CritiqueResults({ report }: { report: CritiqueReport }) {
  if (!report.report) return null;
  const r = report.report;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3 text-sm flex-wrap">
        <span className="pill pill-red">
          blocking: {r.blockingCount}
        </span>
        <span className="pill pill-amber">
          suggestion: {r.suggestionCount}
        </span>
        <span className="pill">
          nit: {r.nitCount}
        </span>
        <span className="text-[var(--color-muted-foreground)] self-center">
          сгенерировано: {new Date(r.generatedAt).toLocaleString("ru-RU")}
        </span>
      </div>
      {report.errorMessage && (
        <p className="text-xs text-[var(--color-ink-amber)]">
          Частичные ошибки: {report.errorMessage}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {r.critics.map((c) => (
          <CriticBlock key={c.critic} report={c} />
        ))}
      </div>
    </div>
  );
}

function CriticBlock({ report }: { report: CriticReport }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="border border-[var(--color-border)] rounded-md">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex justify-between items-center px-3 py-2 text-left hover:bg-[var(--color-accent)]"
      >
        <span className="font-medium">
          {CRITIC_LABELS[report.critic]} · {report.issues.length} замечаний
        </span>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded && (
        <div className="p-3 flex flex-col gap-2 border-t border-[var(--color-border)]">
          <p className="text-sm italic">{report.overallNotes}</p>
          {report.issues.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Замечаний нет.
            </p>
          ) : (
            <ul className="cri-list">
              {report.issues.map((issue, i) => (
                <li key={i} className="cri-card">
                  <div className="cri-card-top">
                    <span
                      aria-hidden="true"
                      className={SEVERITY_DOT[issue.severity]}
                      style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0 }}
                    />
                    <span className="cri-card-title">{issue.summary}</span>
                    <span className="cap-upper">
                      {SEVERITY_LABELS[issue.severity]}
                    </span>
                  </div>
                  {issue.excerpt && (
                    <blockquote className="cri-card-excerpt">
                      {issue.excerpt}
                    </blockquote>
                  )}
                  {issue.suggestion && (
                    <div className="cri-card-sugg">
                      <span className="cap-upper">Предлагается:</span>
                      <code>{issue.suggestion}</code>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
