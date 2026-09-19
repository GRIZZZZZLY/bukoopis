import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Что именно сломалось — в тексте для автора: «Критика», «Материалы». */
  title: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Граница ошибок вокруг одной панели (С13 ревью 2026-09-19).
 *
 * Граница в `main.tsx` одна на всё приложение, поэтому падение любой боковой
 * панели уносило и рукопись: автор терял из виду текст, который в этот момент
 * правил. Панель — часть экрана, и ломаться она должна тоже частью.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[PanelBoundary:${this.props.title}]`, error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel" style={{ padding: 12 }}>
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          {this.props.title}: панель не отрисовалась.
        </p>
        <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
          Текст главы цел. Обновите страницу; если повторится, подробности в
          консоли браузера.
        </p>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => this.setState({ error: null })}
        >
          Попробовать снова
        </button>
      </section>
    );
  }
}
