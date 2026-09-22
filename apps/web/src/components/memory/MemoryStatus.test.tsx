import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  MemoryStatusBadge,
  MemoryStaleBanner,
  MemoryLagWarning,
  MemoryPipelineBanner,
} from "./MemoryStatus";
import type { ChapterMemoryInfo } from "@/api/client";

function mem(
  state: ChapterMemoryInfo["state"],
  bookStaleFromPosition: number | null = null,
  extra: Partial<ChapterMemoryInfo> = {},
): ChapterMemoryInfo {
  return {
    state,
    memoryVersionId: null,
    bookStaleFromPosition,
    pendingEarlierChapters: [],
    pipelineVersion: 2,
    outdatedPipeline: false,
    skipped: null,
    events: null,
    malformed: 0,
    outdatedPipelineChapters: 0,
    ...extra,
  };
}

describe("MemoryStatusBadge", () => {
  it("renders nothing without memory info", () => {
    const { container } = render(
      <MemoryStatusBadge memory={null} onRetry={() => {}} retrying={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows fresh state", () => {
    render(
      <MemoryStatusBadge
        memory={mem("fresh")}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(screen.getByText("Память актуальна")).toBeInTheDocument();
  });

  it("не называет короткую главу разобранной", () => {
    // Пропуск засчитан как успех задания, поэтому состояние честно «свежая» —
    // и подпись «Память актуальна» тут была бы неправдой о содержимом.
    render(
      <MemoryStatusBadge
        memory={mem("fresh", null, { skipped: "short" })}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(screen.queryByText("Память актуальна")).not.toBeInTheDocument();
    expect(
      screen.getByText("Глава короче 80 слов — в память не попала"),
    ).toBeInTheDocument();
  });

  it("не называет память актуальной, если разбор событий упал (F07 ревью 2026-09-22)", () => {
    render(
      <MemoryStatusBadge
        memory={mem("fresh", null, { eventsError: "бэкенд молчит" })}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(screen.queryByText("Память актуальна")).not.toBeInTheDocument();
    expect(screen.getByText(/без событий героев/)).toBeInTheDocument();
  });

  it("называет записи, которые не прижились", () => {
    render(
      <MemoryStatusBadge
        memory={mem("fresh", null, {
          events: {
            inserted: 3,
            duplicates: 0,
            rejectedEvidence: 2,
            unresolved: 1,
          },
          malformed: 1,
        })}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    // 2 отвергнутых доказательства + 1 неразрешённое имя + 1 непринятая
    // схемой строка. Принятые и повторы в число потерь не входят.
    expect(
      screen.getByText("Память актуальна · не прижилось записей: 4"),
    ).toBeInTheDocument();
  });

  it("называет имена, которые не нашлись в составе книги", () => {
    // «Не прижилось записей: 2» говорит, что память потерялась, но не что
    // делать. Имя — единственная зацепка: расхождение между замыслом и
    // составом лечится псевдонимом или переименованием героя.
    render(
      <MemoryStatusBadge
        memory={mem("fresh", null, {
          events: {
            inserted: 0,
            duplicates: 0,
            rejectedEvidence: 0,
            unresolved: 2,
            unresolvedNames: ["Нина", "Ворт"],
          },
          malformed: 0,
        })}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(
      screen.getByText(
        "Память актуальна · не прижилось записей: 2 — в составе книги нет: Нина, Ворт",
      ),
    ).toBeInTheDocument();
  });

  it("shows updating state", () => {
    render(
      <MemoryStatusBadge
        memory={mem("updating")}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(screen.getByText("Память обновляется…")).toBeInTheDocument();
  });

  it("shows not-in-memory state after an autosave-only change", () => {
    render(
      <MemoryStatusBadge
        memory={mem("none")}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(
      screen.getByText("Есть изменения, не добавленные в память"),
    ).toBeInTheDocument();
  });

  it("error state exposes a retry action", () => {
    const onRetry = vi.fn();
    render(
      <MemoryStatusBadge
        memory={mem("error")}
        onRetry={onRetry}
        retrying={false}
      />,
    );
    expect(screen.getByText("Ошибка обновления памяти")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("MemoryLagWarning", () => {
  it("renders nothing when every earlier chapter is indexed", () => {
    const { container } = render(<MemoryLagWarning chapters={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the single chapter still being indexed", () => {
    render(<MemoryLagWarning chapters={[2]} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /Память главы #2 ещё обновляется/,
    );
  });

  it("lists every lagging chapter when there are several", () => {
    render(<MemoryLagWarning chapters={[2, 5]} />);
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent(/#2/);
    expect(warning).toHaveTextContent(/#5/);
  });

  it("warns that generating now would miss that context", () => {
    render(<MemoryLagWarning chapters={[3]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/не попад/i);
  });
});

describe("MemoryStaleBanner", () => {
  it("renders nothing when the book is not stale", () => {
    const { container } = render(
      <MemoryStaleBanner
        staleFromPosition={null}
        onRebuild={() => {}}
        rebuilding={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the stale chapter and triggers rebuild", () => {
    const onRebuild = vi.fn();
    render(
      <MemoryStaleBanner
        staleFromPosition={4}
        onRebuild={onRebuild}
        rebuilding={false}
      />,
    );
    expect(
      screen.getByText(/Память книги устарела начиная с главы #4/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Перестроить с главы #4" }),
    );
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });
});

describe("MemoryPipelineBanner", () => {
  it("молчит, когда вся книга разобрана нынешней версией", () => {
    const { container } = render(
      <MemoryPipelineBanner
        outdatedChapters={0}
        onRebuild={() => {}}
        rebuilding={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("называет число глав и то, чего у них нет", () => {
    render(
      <MemoryPipelineBanner
        outdatedChapters={12}
        onRebuild={() => {}}
        rebuilding={false}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/12/);
    expect(banner).toHaveTextContent(/события героев/i);
  });

  it("не запускает платный разбор с одного нажатия", () => {
    const onRebuild = vi.fn();
    render(
      <MemoryPipelineBanner
        outdatedChapters={12}
        onRebuild={onRebuild}
        rebuilding={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Разобрать заново" }));
    expect(onRebuild).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/платные вызовы/i);

    fireEvent.click(screen.getByRole("button", { name: "Да, разобрать" }));
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it("отмена оставляет всё как было", () => {
    const onRebuild = vi.fn();
    render(
      <MemoryPipelineBanner
        outdatedChapters={3}
        onRebuild={onRebuild}
        rebuilding={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Разобрать заново" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onRebuild).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Разобрать заново" }),
    ).toBeInTheDocument();
  });
});
