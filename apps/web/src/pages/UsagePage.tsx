import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

  if (error)
    return (
      <div className="route">
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: 32 }}>
          <p
            role="alert"
            className="card"
            style={{
              borderLeft: "3px solid var(--color-ink-red)",
              color: "var(--color-ink-red)",
            }}
          >
            Ошибка: {error}
          </p>
        </div>
      </div>
    );
  if (!summary)
    return (
      <div className="route">
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: 32,
            color: "var(--color-text-muted)",
            fontSize: 13,
          }}
        >
          Загрузка…
        </div>
      </div>
    );

  return (
    <div className="route" data-screen-label="Usage">
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "32px 32px 96px",
        }}
      >
        {/* Hero */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 24,
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>
              Использование
            </div>
            <h1
              className="font-display"
              style={{
                fontSize: 32,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
                letterSpacing: "-0.015em",
              }}
            >
              Расходы LLM
            </h1>
            <div
              className="text-muted"
              style={{ fontSize: 13, marginTop: 6 }}
            >
              per-route · per-day · последние 50 вызовов
            </div>
          </div>
          <Link
            to="/books"
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← К списку книг
          </Link>
        </div>

        {/* Filters */}
        <div
          className="panel"
          style={{
            padding: 20,
            marginBottom: 16,
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <span className="caption">Book ID</span>
            <input
              type="number"
              min={1}
              value={bookIdFilter}
              onChange={(e) => setBookIdFilter(e.target.value)}
              placeholder="все книги"
              className="input"
              style={{ width: 120 }}
            />
          </label>
          <label
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <span className="caption">От</span>
            <input
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              className="input"
              style={{ width: 160 }}
            />
          </label>
          <label
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <span className="caption">До</span>
            <input
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              className="input"
              style={{ width: 160 }}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={load}
            disabled={loading}
          >
            {loading ? "…" : "Применить"}
          </button>
        </div>

        {/* Stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <StatCard title="Всего" value={`$${summary.totalUsd.toFixed(4)}`} />
          <StatCard title="Вызовов" value={String(summary.totalCalls)} />
          <StatCard
            title="Tokens in / out"
            value={`${summary.totalInputTokens.toLocaleString("ru-RU")} / ${summary.totalOutputTokens.toLocaleString("ru-RU")}`}
          />
          <StatCard
            title="Cache read / create"
            value={`${summary.totalCacheReadTokens.toLocaleString("ru-RU")} / ${summary.totalCacheCreationTokens.toLocaleString("ru-RU")}`}
          />
        </div>

        {/* Per-route */}
        <section style={{ marginBottom: 24 }}>
          <h2
            className="font-display"
            style={{
              fontSize: 22,
              fontWeight: 500,
              margin: "0 0 12px",
              color: "var(--color-text-strong)",
            }}
          >
            По маршрутам
          </h2>
          {summary.perRoute.length === 0 ? (
            <p
              className="text-muted"
              style={{ fontSize: 13, fontStyle: "italic" }}
            >
              Нет данных в выбранном диапазоне.
            </p>
          ) : (
            <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
              <table
                style={{
                  width: "100%",
                  fontSize: 13,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr
                    className="caption"
                    style={{
                      textAlign: "left",
                      background: "var(--color-surface-2)",
                    }}
                  >
                    <th style={{ padding: "10px 14px" }}>Маршрут</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>
                      Вызовов
                    </th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>
                      Стоимость
                    </th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>
                      Tokens in
                    </th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>
                      Tokens out
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.perRoute.map((row) => (
                    <tr
                      key={row.route}
                      style={{
                        borderTop: "1px solid var(--color-border-soft)",
                      }}
                    >
                      <td
                        className="font-mono"
                        style={{ padding: "10px 14px", fontSize: 12 }}
                      >
                        {row.route}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "10px 14px", textAlign: "right" }}
                      >
                        {row.calls}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "10px 14px", textAlign: "right" }}
                      >
                        ${row.costUsd.toFixed(4)}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "10px 14px", textAlign: "right" }}
                      >
                        {row.inputTokens.toLocaleString("ru-RU")}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "10px 14px", textAlign: "right" }}
                      >
                        {row.outputTokens.toLocaleString("ru-RU")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Per-day spark */}
        <section style={{ marginBottom: 24 }}>
          <h2
            className="font-display"
            style={{
              fontSize: 22,
              fontWeight: 500,
              margin: "0 0 12px",
              color: "var(--color-text-strong)",
            }}
          >
            По дням
          </h2>
          {summary.perDay.length === 0 ? (
            <p
              className="text-muted"
              style={{ fontSize: 13, fontStyle: "italic" }}
            >
              Нет дней с активностью.
            </p>
          ) : (
            <PerDaySpark data={summary.perDay} />
          )}
        </section>

        {/* Recent calls */}
        <section>
          <h2
            className="font-display"
            style={{
              fontSize: 22,
              fontWeight: 500,
              margin: "0 0 12px",
              color: "var(--color-text-strong)",
            }}
          >
            Последние 50 вызовов
          </h2>
          {summary.recent.length === 0 ? (
            <p
              className="text-muted"
              style={{ fontSize: 13, fontStyle: "italic" }}
            >
              Пусто.
            </p>
          ) : (
            <div
              className="panel"
              style={{ padding: 0, overflow: "auto" }}
            >
              <table
                style={{
                  width: "100%",
                  fontSize: 12,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr
                    className="caption"
                    style={{
                      textAlign: "left",
                      background: "var(--color-surface-2)",
                    }}
                  >
                    <th style={{ padding: "10px 14px" }}>Когда</th>
                    <th style={{ padding: "10px 14px" }}>Маршрут</th>
                    <th style={{ padding: "10px 14px" }}>Модель</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>in</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>out</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>cache R/W</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>$</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>book/ch/v</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((r) => (
                    <tr
                      key={r.id}
                      style={{
                        borderTop: "1px solid var(--color-border-soft)",
                      }}
                    >
                      <td style={{ padding: "8px 14px" }}>
                        {new Date(r.createdAt).toLocaleString("ru-RU")}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "8px 14px" }}
                      >
                        {r.route}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "8px 14px" }}
                      >
                        {r.model}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "8px 14px", textAlign: "right" }}
                      >
                        {r.inputTokens}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "8px 14px", textAlign: "right" }}
                      >
                        {r.outputTokens}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "8px 14px", textAlign: "right" }}
                      >
                        {r.cacheReadInputTokens}/{r.cacheCreationInputTokens}
                      </td>
                      <td
                        className="font-mono"
                        style={{ padding: "8px 14px", textAlign: "right" }}
                      >
                        ${r.costUsd.toFixed(4)}
                      </td>
                      <td
                        className="font-mono"
                        style={{
                          padding: "8px 14px",
                          textAlign: "right",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {r.bookId ?? "–"}/{r.chapterId ?? "–"}/{r.versionId ?? "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="caption">{title}</div>
      <div
        className="font-mono"
        style={{
          fontSize: 18,
          color: "var(--color-text-strong)",
          marginTop: 8,
        }}
      >
        {value}
      </div>
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
    <div className="panel" style={{ padding: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${sorted.length}, 1fr)`,
          gap: 6,
          alignItems: "end",
          minHeight: 80,
        }}
      >
        {sorted.map((d) => {
          const h = Math.max(2, (d.costUsd / maxCost) * 60);
          return (
            <div
              key={d.date}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
              title={`${d.date}: $${d.costUsd.toFixed(4)} · ${d.calls} вызовов`}
            >
              <div
                style={{
                  background: "var(--color-brass)",
                  width: "100%",
                  borderRadius: 2,
                  height: `${h}px`,
                }}
              />
              <div
                className="font-mono"
                style={{
                  fontSize: 9,
                  color: "var(--color-text-faint)",
                  transform: "rotate(45deg)",
                  transformOrigin: "top left",
                  whiteSpace: "nowrap",
                }}
              >
                {d.date.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
