import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import {
  STAGE_IDS,
  computeStudioProgress,
  effectiveStageStatus,
  isPlanApproved,
} from "@book-forge/shared";
import type {
  BookConcept,
  ChapterProgress,
  StageId,
  StudioState,
  StudioWarning,
} from "@book-forge/shared";
import { QuickStartPanel } from "@/components/studio/QuickStartPanel";
import { useBookRoom } from "@/components/book/BookLayout";
import { StageStatusDot, stageStatusLabel } from "@/components/book/StageStatus";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { STAGE_LABELS } from "@/lib/labels";
import { stageRoute } from "@/lib/studio-routes";

/** Что предлагает кнопка «Следующий шаг» на каждом этапе. */
const NEXT_ACTION: Record<StageId, { title: string; text: string }> = {
  concept: {
    title: "Утвердить замысел",
    text: "Опишите идею, выберите питч и утвердите карточку замысла — на ней строится всё остальное.",
  },
  world: {
    title: "Собрать мир",
    text: "Модель напишет документ о мире книги. Вы прочтёте, поправите и утвердите его.",
  },
  lore: {
    title: "Собрать лор",
    text: "История и правила мира. Этап можно пропустить, если книге он не нужен.",
  },
  characters: {
    title: "Утвердить персонажей",
    text: "Модель предложит персонажей по замыслу и миру. Принятые уйдут в Канон.",
  },
  items: {
    title: "Утвердить предметы",
    text: "Важные для сюжета вещи. Этап можно пропустить.",
  },
  plot: {
    title: "Утвердить план",
    text: "Сравните варианты плана глава за главой, выберите один и утвердите — после этого главы станут доступны для письма.",
  },
  chapters: {
    title: "Писать главы",
    text: "План утверждён. Откройте главу и напишите её сами или вместе с моделью.",
  },
};

const SEVERITY_LABEL: Record<StudioWarning["severity"], string> = {
  danger: "Важно",
  warning: "Внимание",
  info: "Совет",
};

interface Loaded {
  concept: BookConcept;
  studio: StudioState;
  warnings: StudioWarning[];
  chapters: ChapterProgress;
}

export function BookOverviewPage() {
  const { bookId, book, reloadBook } = useBookRoom();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.getConcept(bookId),
      api.getStudioState(bookId),
      api.getStudioWarnings(bookId),
      api.listChapters(bookId),
    ])
      .then(([concept, studio, warnings, list]) => {
        if (!alive) return;
        setData({
          concept,
          studio,
          warnings,
          chapters: {
            total: list.length,
            finalized: list.filter((c) => c.status === "final").length,
          },
        });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [bookId, tick]);

  if (error) return <p role="alert" className="alert-error">Ошибка: {error}</p>;
  if (!data) return <PageSkeleton label="Обзор загружается" />;

  // Готовность плана видна только по колонке книги: аспектов у этапа нет.
  const plan = { approved: isPlanApproved(book?.outlineJson ?? null) };
  const progress = computeStudioProgress(data.concept, data.studio, data.chapters, plan);
  const next = progress.recommended;
  const action = next ? NEXT_ACTION[next] : null;
  const nextHref = next
    ? next === "chapters"
      ? `/books/${bookId}/chapters`
      : stageRoute(bookId, next)
    : `/books/${bookId}/chapters`;

  const refresh = () => {
    setTick((t) => t + 1);
    reloadBook();
  };

  return (
    <div className="route overview">
      <section className="next-step" aria-label="Следующий шаг">
        <div className="next-step-text">
          <span className="kicker">Следующий шаг</span>
          <h2>{action ? action.title : "Книга проработана"}</h2>
          <p className="muted">
            {action
              ? action.text
              : "Все этапы пройдены. Возвращайтесь к главам — или к любому этапу, чтобы что-то поменять."}
          </p>
        </div>
        <div className="next-step-actions">
          <Link to={nextHref} className="btn btn-primary btn-lg">
            {action ? action.title : "Открыть главы"}
          </Link>
          {next && next !== "chapters" && (
            <QuickStartPanel bookId={bookId} onFinished={refresh} />
          )}
        </div>
      </section>

      <section aria-labelledby="path-title">
        <div className="section-head">
          <h3 id="path-title">Путь книги</h3>
          <span className="faint">этап открывается в Мастерской</span>
        </div>
        <ol className="path">
          {STAGE_IDS.map((id, i) => {
            const status = effectiveStageStatus(data.concept, data.studio, id, data.chapters, plan);
            return (
              <li key={id} className={id === next ? "path-step path-step-next" : "path-step"}>
                <Link to={stageRoute(bookId, id)} className="path-link">
                  <span className="path-num mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="path-name">{STAGE_LABELS[id]}</span>
                  <span className="path-status">
                    <StageStatusDot status={status} />
                    {stageStatusLabel(status)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="warn-title">
        <div className="section-head">
          <h3 id="warn-title">Предупреждения</h3>
          <span className="faint">
            {data.warnings.length === 0 ? "нет" : `${data.warnings.length} открытых`}
          </span>
        </div>
        {data.warnings.length === 0 ? (
          <p className="muted">Предупреждений нет.</p>
        ) : (
          <ul className="warn-list">
            {data.warnings.map((w) => (
              <li key={w.id} className="warn-row" {...(w.severity === "danger" ? { role: "alert" } : {})}>
                <span className={`warn-kind warn-kind-${w.severity}`}>
                  <span className="warn-dot" aria-hidden="true" />
                  {w.stageId ? STAGE_LABELS[w.stageId] : SEVERITY_LABEL[w.severity]}
                </span>
                <span className="warn-text">{w.message}</span>
                {w.action ? (
                  <Link to={w.action.href} className="warn-act">
                    {w.action.label}
                  </Link>
                ) : w.stageId ? (
                  <Link to={stageRoute(bookId, w.stageId)} className="warn-act">
                    Открыть этап
                  </Link>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
