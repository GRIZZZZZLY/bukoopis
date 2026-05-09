import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info);
    this.setState({ info });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="max-w-2xl mx-auto p-8 flex flex-col gap-4">
        <h1 className="text-xl font-bold text-red-600">
          Что-то сломалось при рендере страницы
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Детали ниже. Также проверь консоль (F12) — там полный stack trace.
        </p>
        <pre className="text-xs whitespace-pre-wrap rounded-md border border-[var(--color-border)] p-3 bg-[var(--color-muted)]">
          {this.state.error.message}
          {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
        </pre>
        {this.state.info?.componentStack && (
          <pre className="text-xs whitespace-pre-wrap rounded-md border border-[var(--color-border)] p-3 bg-[var(--color-muted)]">
            {this.state.info.componentStack}
          </pre>
        )}
        <button
          type="button"
          className="self-start text-sm underline"
          onClick={() => {
            this.setState({ error: null, info: null });
          }}
        >
          Перезагрузить страницу
        </button>
      </main>
    );
  }
}
