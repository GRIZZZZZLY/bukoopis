import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, streamRepair } from "@/api/client";
import {
  ProposalPanel,
  type ProposalReread,
} from "@/components/chapter/ProposalPanel";
import {
  ALL_CRITIC_TYPES,
  CRITIC_LABELS,
  issueIdFor,
  SEVERITY_LABELS,
  REPAIR_MAX_ITERATIONS,
  type CritiqueReport,
  type CriticReport,
  type CriticType,
  type CritiqueIssue,
  type IssueSeverity,
  type ProseChange,
  type ProseProposal,
} from "@book-forge/shared";

interface Props {
  versionId: number | null;
  /** Что вкладка считает текущей версией главы — сверяется сервером при
   *  принятии кандидата self-repair'а. `CritiquePanel` не знает главу целиком,
   *  поэтому это приходит от `ChapterPage`. */
  expectedVersionId: number | null;
  /** Что вкладка считает ревизией черновика; `null` только если черновика
   *  действительно нет. Раньше здесь всегда передавался `null`, из-за чего
   *  принятие self-repair отваливалось 409-м у любого автора с автосейвом. */
  expectedDraftRevision: number | null;
  /** Перечитать главу после 409 и вернуть свежие ожидания. Панель критики
   *  главы не знает, поэтому перечитывает её `ChapterPage`. */
  onRereadProposal?: (proposalId: number) => Promise<ProposalReread>;
  onRepairDone?: () => void | Promise<void>;
  /** Слов в версии, от которой сейчас считается self-repair. */
  baseWordCount?: number | null;
  /** Имена героев книги — панель кандидата ищет по ним пропавшие упоминания. */
  characterNames?: string[];
}

const SEVERITY_DOT: Record<IssueSeverity, string> = {
  blocking: "sev-red",
  suggestion: "sev-amber",
  nit: "sev-blue",
};

function criticNames(critics: readonly CriticType[]): string {
  return critics.map((c) => CRITIC_LABELS[c]).join(", ");
}

/** Кого просили проверить. Старые отчёты (до появления поля) списка не несут —
 *  тогда молчим, а не врём про «все четыре». */
function requestedList(report: CritiqueReport): string {
  return report.report ? criticNames(report.report.requestedCritics) : "";
}

function failedList(report: CritiqueReport): string {
  return report.report ? criticNames(report.report.failedCritics) : "";
}

export function CritiquePanel({
  versionId,
  expectedVersionId,
  expectedDraftRevision,
  onRereadProposal,
  onRepairDone,
  baseWordCount,
  characterNames,
}: Props) {
  const [report, setReport] = useState<CritiqueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [enabled, setEnabled] = useState<Set<CriticType>>(
    new Set(ALL_CRITIC_TYPES),
  );
  const [error, setError] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairBuffer, setRepairBuffer] = useState("");
  const [repairIteration, setRepairIteration] = useState<{
    current: number;
    max: number;
  } | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairProposal, setRepairProposal] = useState<ProseProposal | null>(
    null,
  );
  const [repairProposalChanges, setRepairProposalChanges] = useState<
    ProseChange[]
  >([]);
  const [repairProposalId, setRepairProposalId] = useState<number | null>(
    null,
  );
  const [repairProtectedLost, setRepairProtectedLost] = useState<string[]>([]);
  const [repairStopping, setRepairStopping] = useState(false);
  /** Выбранные автором замечания (этап 5). Пустой набор = «не выбирал», и
   *  тогда работает прежний фильтр по серьёзности. */
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  /** Куски, которых правка не касается: по одному на строку. */
  const [protectedText, setProtectedText] = useState("");
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

  /** Выбор замечания. Набор пуст = автор не выбирал, и правка идёт прежним
   *  фильтром по серьёзности. */
  function toggleIssue(id: string) {
    setSelectedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  /** Остановить идущий self-repair. Сервер умеет это с той минуты, как repair
   *  стал заводить кандидата до первого токена: отмена помечает кандидата и
   *  просит поток прекратиться. Кнопки не было, и остановить было нечем. */
  async function onStopRepair() {
    if (repairProposalId === null) return;
    setRepairStopping(true);
    try {
      await api.cancelProposal(repairProposalId);
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRepair() {
    if (versionId === null) return;
    setRepairing(true);
    setRepairBuffer("");
    setRepairError(null);
    setRepairIteration(null);
    setRepairProposal(null);
    setRepairProposalChanges([]);
    setRepairProposalId(null);
    setRepairProtectedLost([]);
    setRepairStopping(false);
    try {
      const severities =
        severityFilter.size === 3 ? undefined : [...severityFilter];
      const protectedFragments = protectedText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      await streamRepair(
        versionId,
        {
          ...(severities ? { severities } : {}),
          ...(selectedIssues.size > 0 ? { selectedIssueIds: [...selectedIssues] } : {}),
          ...(protectedFragments.length > 0 ? { protectedFragments } : {}),
        },
        {
        onIteration: (current, max) =>
          setRepairIteration({ current, max }),
        onProposal: (proposalId) => setRepairProposalId(proposalId),
        onChunk: (text) => setRepairBuffer((b) => b + text),
        onDone: async (payload) => {
          setRepairing(false);
          setRepairStopping(false);
          // Остановленный кандидат принять нельзя (сервер откажет по
          // статусу), поэтому предлагать его к принятию — обман.
          if (payload.cancelled) {
            setRepairProposalId(null);
            setRepairError("Правка остановлена. Глава не изменилась.");
            return;
          }
          setRepairProposal(payload.proposal);
          setRepairProtectedLost(payload.protectedLost ?? []);
          const { changes } = await api.getProposalChanges(payload.proposal.id);
          setRepairProposalChanges(changes);
        },
          onError: (msg) => {
            setRepairError(msg);
            setRepairing(false);
            setRepairStopping(false);
          },
        },
      );
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : String(e));
      setRepairing(false);
      setRepairStopping(false);
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
        <h2 className="text-xl font-semibold">Разбор версии</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {ALL_CRITIC_TYPES.map((c) => (
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

      {error && <p className="text-sm text-[var(--color-ink-red-fg)]">Ошибка: {error}</p>}
      {loading && <p className="text-sm">Загрузка…</p>}

      {!loading && !report && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Разбор ещё не запускался для этой версии.
        </p>
      )}

      {report && report.status === "error" && (
        <div className="border border-[var(--color-ink-red-fg)] rounded-md p-3 flex flex-col gap-1">
          <p className="text-sm text-[var(--color-ink-red-fg)]">
            Разбор не удался: ни один критик не ответил.
            {requestedList(report) && ` Просили: ${requestedList(report)}.`}
          </p>
          {report.errorMessage && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {report.errorMessage}
            </p>
          )}
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Замечаний нет не потому, что их нет, а потому, что разбора не было.
            Запустите критику ещё раз.
          </p>
        </div>
      )}

      {report && report.status === "partial" && (
        <div className="border border-[var(--color-ink-amber-fg)] rounded-md p-3 flex flex-col gap-1">
          <p className="text-sm text-[var(--color-ink-amber-fg)]">
            Разбор неполный: не ответили {failedList(report)}. Ниже — только
            то, что успели сказать остальные.
          </p>
          {report.errorMessage && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {report.errorMessage}
            </p>
          )}
        </div>
      )}

      {report && report.report?.baseChanged === true && (
        <div
          role="status"
          className="card"
          style={{
            borderLeft: "3px solid var(--color-ink-amber)",
            fontSize: 13,
            padding: "10px 14px",
          }}
        >
          Глава написана на прежней базе: с тех пор изменились герои, план или
          предыдущие главы. Часть замечаний может быть следствием этого, а не
          ошибкой текста.
        </div>
      )}

      {report && report.status !== "error" && report.report && (
        <CritiqueResults
          report={report}
          selectedIssues={selectedIssues}
          onToggleIssue={toggleIssue}
        />
      )}

      {report &&
        report.status !== "error" &&
        report.report &&
        (report.report.blockingCount + report.report.suggestionCount > 0 ||
          repairing ||
          repairBuffer ||
          repairError) && (
          <div className="border border-[var(--color-border)] rounded-md p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-medium">Исправить</div>
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
                {selectedIssues.size > 0 && (
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    выбрано замечаний: {selectedIssues.size} — правится только это
                  </span>
                )}
                <Button onClick={onRepair} disabled={repairing}>
                  {repairing ? "Идёт правка…" : "Исправить главу"}
                </Button>
                {repairing && (
                  <Button
                    variant="secondary"
                    onClick={() => void onStopRepair()}
                    disabled={repairProposalId === null || repairStopping}
                  >
                    {repairStopping ? "Останавливаю…" : "Остановить"}
                  </Button>
                )}
              </div>
            </div>
            {/* Куски, которых правка не коснётся (AC-29). Дословные цитаты:
                сервер находит их в тексте версии до вызова модели и отвергает
                то, что встречается дважды. */}
            <label className="text-xs flex flex-col gap-1">
              Не трогать (по одному куску на строку, дословно из главы)
              <textarea
                rows={2}
                value={protectedText}
                onChange={(e) => setProtectedText(e.target.value)}
                disabled={repairing}
                className="text-xs border border-[var(--color-border)] rounded p-1 font-mono"
              />
            </label>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Глава будет переписана с приоритетом по выбранным severity.
              Результат придёт кандидатом ниже — его нужно принять (целиком
              или частично) или отклонить, глава сама не изменится.
              Лимит итераций: {REPAIR_MAX_ITERATIONS}.
            </p>
            {repairIteration && (
              <p className="text-xs">
                Итерация {repairIteration.current} / {repairIteration.max}
              </p>
            )}
            {repairError && (
              <p className="text-sm text-[var(--color-ink-red-fg)]">Ошибка: {repairError}</p>
            )}
            {repairing && repairBuffer && (
              <div className="border border-[var(--color-ring)] rounded-md p-3 bg-[var(--color-muted)] max-h-[300px] overflow-auto">
                <div className="text-xs text-[var(--color-muted-foreground)] mb-2">
                  Идёт правка; по готовности текст ляжет кандидатом ниже — его
                  ещё нужно принять:
                </div>
                <pre className="whitespace-pre-wrap text-sm font-sans">
                  {repairBuffer}
                </pre>
              </div>
            )}
            {repairProposal && (
              <ProposalPanel
                proposal={repairProposal}
                changes={repairProposalChanges}
                expectedVersionId={expectedVersionId}
                expectedDraftRevision={expectedDraftRevision}
                baseWordCount={baseWordCount ?? null}
                protectedLost={repairProtectedLost}
                characterNames={characterNames ?? []}
                {...(onRereadProposal
                  ? {
                      onReread: async () => {
                        const fresh = await onRereadProposal(
                          repairProposal.id,
                        );
                        setRepairProposalChanges(fresh.changes);
                        return fresh;
                      },
                    }
                  : {})}
                onAccepted={async () => {
                  setRepairProposal(null);
                  setRepairProposalChanges([]);
                  setRepairProposalId(null);
                  setRepairBuffer("");
                  if (onRepairDone) await onRepairDone();
                }}
                onRejected={() => {
                  setRepairProposal(null);
                  setRepairProposalChanges([]);
                  setRepairProposalId(null);
                  setRepairBuffer("");
                }}
              />
            )}
          </div>
        )}
    </section>
  );
}

function CritiqueResults({
  report,
  selectedIssues,
  onToggleIssue,
}: {
  report: CritiqueReport;
  selectedIssues: ReadonlySet<string>;
  onToggleIssue: (id: string) => void;
}) {
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
      {r.requestedCritics.length > 0 && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Ответили {r.critics.length} из {r.requestedCritics.length}. Просили:{" "}
          {criticNames(r.requestedCritics)}.
        </p>
      )}
      {/* Пропуск — не успех и не ошибка. Без этой строки сцена, где критик
          персонажей не запускался, выглядела бы полностью проверенной. */}
      {(r.skippedCritics?.length ?? 0) > 0 && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Не запускались: {criticNames(r.skippedCritics ?? [])} — в сцене меньше
          двух названных героев.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {r.critics.map((c) => (
          <CriticBlock
            key={c.critic}
            report={c}
            selectedIssues={selectedIssues}
            onToggleIssue={onToggleIssue}
          />
        ))}
      </div>
    </div>
  );
}

/** Дополнительные поля замечания критика персонажей: кого касается, на чём
 *  основано, что стоит сохранить и как это ещё можно прочесть. Собрать их и
 *  не показать значит спрятать от автора половину разбора. */
function CharacterIssueDetails({ issue }: { issue: CritiqueIssue }) {
  const rows: Array<[string, string]> = [];
  if (issue.affectedCharacters && issue.affectedCharacters.length > 0) {
    rows.push(["Герои:", issue.affectedCharacters.join(", ")]);
  }
  if (issue.basis) rows.push(["Основание:", issue.basis]);
  if (issue.whyHere) rows.push(["Почему здесь:", issue.whyHere]);
  if (issue.alternativeReading) {
    rows.push(["Может быть и так:", issue.alternativeReading]);
  }
  if (issue.keep) rows.push(["Сохранить:", issue.keep]);
  if (rows.length === 0) return null;
  return (
    <dl className="cri-card-meta text-xs flex flex-col gap-0.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-1">
          <dt className="cap-upper shrink-0">{label}</dt>
          <dd className="text-[var(--color-muted-foreground)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CriticBlock({
  report,
  selectedIssues,
  onToggleIssue,
}: {
  report: CriticReport;
  selectedIssues: ReadonlySet<string>;
  onToggleIssue: (id: string) => void;
}) {
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
                    {/* Выбор автора: правится только отмеченное. Без отметок
                        работает прежний фильтр по серьёзности. */}
                    <input
                      type="checkbox"
                      aria-label={`Править это замечание: ${issue.summary}`}
                      checked={selectedIssues.has(issueIdFor(report.critic, i))}
                      onChange={() => onToggleIssue(issueIdFor(report.critic, i))}
                      style={{ flexShrink: 0 }}
                    />
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
                      <span className="cri-card-sugg-text">
                        {issue.suggestion}
                      </span>
                    </div>
                  )}
                  {/* Поля критика персонажей. У остальных критиков их нет, и
                      подписи не появляются вовсе: пустой заголовок читается
                      как утверждение. */}
                  <CharacterIssueDetails issue={issue} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
