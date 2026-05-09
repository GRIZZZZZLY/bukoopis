import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { UsageSummary } from "@book-forge/shared";

export function UsagePage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookIdFilter, setBookIdFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const params: { bookId?: number; from?: string; to?: string } = {};
      if (bookIdFilter.trim()) params.bookId = Number(bookIdFilter);
      if (fromFilter) params.from = `${fromFilter}T00:00:00.000Z`;
      if (toFilter) params.to = `${toFilter}T23:59:59.999Z`;
      const result = await api.getUsage(params);
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="p-8">Ошибка: {error}</p>;
  if (!summary) return <p className="p-8">Загрузка…</p>;

  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-6">
      <Link to="/books" className="text-sm underline">
        ← К списку книг
      </Link>
      <h1 className="text-3xl font-bold">Расходы LLM</h1>

      <section className="flex gap-2 items-end flex-wrap">
        <label className="text-xs flex flex-col gap-1">
          <span>Book ID</span>
          <input
            type="number"
            min={1}
            value={bookIdFilter}
            onChange={(e) => setBookIdFilter(e.target.value)}
            placeholder="все книги"
            className="border border-[var(--color-input)] rounded-md px-2 py-1 w-24 text-sm"
          />
        </label>
        <label className="text-xs flex flex-col gap-1">
          <span>От</span>
          <input
            type="date"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs flex flex-col gap-1">
          <span>До</span>
          <input
            type="date"
            value={toFilter}
            onChange={(e) => setToFilter(e.target.value)}
            className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
          />
        </label>
        <Button onClick={load} disabled={loading}>
          {loading ? "…" : "Применить"}
        </Button>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Всего" value={`$${summary.totalUsd.toFixed(4)}`} />
        <Card title="Вызовов" value={String(summary.totalCalls)} />
        <Card
          title="Tokens in / out"
          value={`${summary.totalInputTokens.toLocaleString("ru-RU")} / ${summary.totalOutputTokens.toLocaleString("ru-RU")}`}
        />
        <Card
          title="Cache read / create"
          value={`${summary.totalCacheReadTokens.toLocaleString("ru-RU")} / ${summary.totalCacheCreationTokens.toLocaleString("ru-RU")}`}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">По маршрутам</h2>
        {summary.perRoute.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Нет данных в выбранном диапазоне.
          </p>
        ) : (
          <table className="w-full text-sm border border-[var(--color-border)] rounded-md">
            <thead>
              <tr className="text-left bg-[var(--color-muted)]">
                <th className="p-2">Маршрут</th>
                <th className="p-2 text-right">Вызовов</th>
                <th className="p-2 text-right">Стоимость</th>
                <th className="p-2 text-right">Tokens in</th>
                <th className="p-2 text-right">Tokens out</th>
              </tr>
            </thead>
            <tbody>
              {summary.perRoute.map((row) => (
                <tr key={row.route} className="border-t border-[var(--color-border)]">
                  <td className="p-2 font-mono text-xs">{row.route}</td>
                  <td className="p-2 text-right">{row.calls}</td>
                  <td className="p-2 text-right">${row.costUsd.toFixed(4)}</td>
                  <td className="p-2 text-right">
                    {row.inputTokens.toLocaleString("ru-RU")}
                  </td>
                  <td className="p-2 text-right">
                    {row.outputTokens.toLocaleString("ru-RU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">По дням</h2>
        {summary.perDay.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Нет дней с активностью.
          </p>
        ) : (
          <PerDaySpark data={summary.perDay} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Последние 50 вызовов</h2>
        {summary.recent.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Пусто.</p>
        ) : (
          <table className="w-full text-xs border border-[var(--color-border)] rounded-md">
            <thead>
              <tr className="text-left bg-[var(--color-muted)]">
                <th className="p-2">Когда</th>
                <th className="p-2">Маршрут</th>
                <th className="p-2">Модель</th>
                <th className="p-2 text-right">in</th>
                <th className="p-2 text-right">out</th>
                <th className="p-2 text-right">cache R/W</th>
                <th className="p-2 text-right">$</th>
                <th className="p-2 text-right">book/ch/v</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="p-2">
                    {new Date(r.createdAt).toLocaleString("ru-RU")}
                  </td>
                  <td className="p-2 font-mono">{r.route}</td>
                  <td className="p-2 font-mono">{r.model}</td>
                  <td className="p-2 text-right">{r.inputTokens}</td>
                  <td className="p-2 text-right">{r.outputTokens}</td>
                  <td className="p-2 text-right">
                    {r.cacheReadInputTokens}/{r.cacheCreationInputTokens}
                  </td>
                  <td className="p-2 text-right">${r.costUsd.toFixed(4)}</td>
                  <td className="p-2 text-right text-[var(--color-muted-foreground)]">
                    {r.bookId ?? "–"}/{r.chapterId ?? "–"}/{r.versionId ?? "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="border border-[var(--color-border)] rounded-md p-3">
      <div className="text-xs text-[var(--color-muted-foreground)]">{title}</div>
      <div className="text-lg font-medium mt-1">{value}</div>
    </div>
  );
}

function PerDaySpark({
  data,
}: {
  data: Array<{ date: string; costUsd: number; calls: number }>;
}) {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const maxCost = Math.max(...sorted.map((d) => d.costUsd), 0.0001);
  return (
    <div className="border border-[var(--color-border)] rounded-md p-3">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${sorted.length}, 1fr)` }}>
        {sorted.map((d) => {
          const h = Math.max(2, (d.costUsd / maxCost) * 60);
          return (
            <div
              key={d.date}
              className="flex flex-col items-center gap-1"
              title={`${d.date}: $${d.costUsd.toFixed(4)} · ${d.calls} вызовов`}
            >
              <div
                className="bg-[var(--color-primary)] w-full rounded-sm"
                style={{ height: `${h}px` }}
              />
              <div className="text-[10px] text-[var(--color-muted-foreground)] rotate-45 origin-top-left">
                {d.date.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
