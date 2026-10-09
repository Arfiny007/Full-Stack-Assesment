import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
type Summary = Record<
  | "net_total"
  | "processed_events"
  | "pending_ack"
  | "unresolved"
  | "duplicates"
  | "conflicts"
  | "rejected_submissions",
  number
>;
type Row = {
  event_id: string | null;
  source_id?: string;
  type?: string;
  status: string;
  message?: string;
  quantity?: number;
  event_time?: string;
  received_at?: string;
  reversed_by?: string;
};
type Mqtt = {
  enabled: boolean;
  connected: boolean;
  candidate_id: string | null;
  last_challenge_id: string | null;
  last_challenge_time: string | null;
  response_status: string | null;
  challenge_count: number;
  last_error: string | null;
  connection_error: string | null;
};
async function api(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string" ? data.error : JSON.stringify(data.error),
    );
  return data;
}
const key = (row: Row) => JSON.stringify([row.source_id, row.event_id]);
const labels: Record<keyof Summary, string> = {
  net_total: "Net production",
  processed_events: "Processed events",
  pending_ack: "Pending ACK",
  unresolved: "Unresolved VOIDs",
  duplicates: "Duplicates",
  conflicts: "Conflicts",
  rejected_submissions: "Rejected Submissions",
};
function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status.toLowerCase()}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
function App() {
  const [summary, setSummary] = useState<Summary | null>(null),
    [mqtt, setMqtt] = useState<Mqtt | null>(null);
  const [pending, setPending] = useState<Row[]>([]),
    [exceptions, setExceptions] = useState<Row[]>([]);
  const [view, setView] = useState<"pending" | "exceptions">("pending"),
    [filter, setFilter] = useState(""),
    [source, setSource] = useState("");
  const [json, setJson] = useState(""),
    [results, setResults] = useState<Row[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [updated, setUpdated] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    const suffix = source ? "&source_id=" + encodeURIComponent(source) : "";
    try {
      const [s, p, e] = await Promise.all(
        ["summary", "pending", "exceptions"].map((v) =>
          api("/api/state?view=" + v + suffix),
        ),
      );
      if (current !== generation.current) return;
      setSummary(s.summary);
      setMqtt(s.mqtt);
      setPending(p.pending);
      setExceptions(e.exceptions);
      setSelected(
        (old) =>
          new Set(
            [...old].filter((k) => p.pending.some((r: Row) => key(r) === k)),
          ),
      );
      setUpdated(new Date().toLocaleTimeString());
      setError("");
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [source]);
  useEffect(() => {
    generation.current++;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [refresh]);
  function applySource(next: string) {
    setFilter(next);
    setSelected(new Set());
    if (next === source) {
      void refresh();
      return;
    }
    // Invalidate in-flight responses before the new source's effect runs.
    generation.current++;
    setSource(next);
    setSummary(null);
    setPending([]);
    setExceptions([]);
    setResults([]);
    setNotice("");
    setError("");
    setUpdated("");
    setLoading(true);
  }
  async function submit() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      let value;
      try {
        value = JSON.parse(json);
      } catch {
        throw new Error("Enter valid JSON: one event object or an array.");
      }
      const data = await api("/api/events", value);
      setResults(data.results);
      await refresh();
      setNotice(`${data.results.length} submission result(s) saved.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ack() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const groups = new Map<string, string[]>();
      for (const row of pending.filter((r) => selected.has(key(r))))
        groups.set(row.source_id!, [
          ...(groups.get(row.source_id!) ?? []),
          row.event_id!,
        ]);
      const outcomes: Row[] = [];
      for (const [source_id, event_ids] of groups) {
        const data = await api("/api/ack", { source_id, event_ids });
        outcomes.push(...data.results.map((r: Row) => ({ ...r, source_id })));
      }
      setResults(outcomes);
      setSelected(new Set());
      await refresh();
      setNotice("Acknowledgement results saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function example(type: "COUNT" | "VOID") {
    setJson(
      JSON.stringify(
        {
          source_id: source || "line-a",
          event_id: (type === "COUNT" ? "C-" : "V-") + Date.now(),
          type,
          ...(type === "COUNT"
            ? { quantity: 10 }
            : { target_event_id: "REPLACE_WITH_COUNT_ID" }),
          event_time: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
  const rows = view === "pending" ? pending : exceptions;
  const selectable = pending.filter((r) => r.type === "COUNT");
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">FACTORY OPERATIONS</p>
          <h1>Production events</h1>
          <p className="muted">
            Live quantities, corrections, and supervisor acknowledgements.
          </p>
        </div>
        <div className="refresh">
          <button onClick={() => void refresh()} disabled={loading || busy}>
            {loading ? "Refreshing…" : "Refresh state"}
          </button>
          <small>
            {updated ? "Updated " + updated : "Connecting to database…"}
          </small>
        </div>
      </header>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="alert success">
          {notice}
        </div>
      )}
      <form
        className="filter"
        onSubmit={(e) => {
          e.preventDefault();
          if (!loading && !busy) applySource(filter.trim());
        }}
      >
        <label htmlFor="source">Production source</label>
        <input
          id="source"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="All sources"
        />
        <button disabled={loading || busy}>Apply filter</button>
        <button
          type="button"
          disabled={loading || busy || (!source && !filter)}
          onClick={() => applySource("")}
        >
          Clear filter
        </button>
        <span className="muted">
          {source ? "Showing " + source : "Showing all sources"} · Auto refresh
          every 10s
        </span>
      </form>
      <section className="metrics" aria-label="Production summary">
        {Object.entries(labels).map(([k, label]) => (
          <article
            className={
              "metric " +
              (k === "net_total"
                ? "primary"
                : k === "rejected_submissions"
                  ? "rejections"
                  : "")
            }
            data-metric={k}
            key={k}
          >
            <span>{label}</span>
            <strong>
              {summary ? summary[k as keyof Summary].toLocaleString() : "—"}
            </strong>
            <small>
              {k === "net_total"
                ? "Units after applied corrections"
                : k === "pending_ack"
                  ? "Ready for supervisor review"
                  : k === "duplicates" ||
                      k === "conflicts" ||
                      k === "rejected_submissions"
                    ? "Persisted submission attempts"
                    : "Distinct stored events"}
            </small>
          </article>
        ))}
      </section>
      <div className="workspace">
        <section className="panel submit">
          <div className="panel-title">
            <h2>Submit events</h2>
            <span className="muted">REST API</span>
          </div>
          <p className="muted">
            Paste one JSON event or an array. Each item receives its own result.
          </p>
          <div className="examples">
            <button onClick={() => example("COUNT")} disabled={busy}>
              COUNT template
            </button>
            <button onClick={() => example("VOID")} disabled={busy}>
              VOID template
            </button>
          </div>
          <label htmlFor="payload">Event JSON</label>
          <textarea
            id="payload"
            spellCheck={false}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder={
              '{ "source_id": "…", "event_id": "…", "type": "COUNT", "quantity": 10, "event_time": "…" }'
            }
          />
          <button
            className="solid"
            onClick={() => void submit()}
            disabled={busy || !json.trim()}
          >
            {busy ? "Processing…" : "Process events"}
          </button>
          {results.length > 0 && (
            <div className="results" aria-live="polite">
              <h3>Latest results</h3>
              {results.map((r, i) => (
                <article key={i}>
                  <div>
                    <b>
                      {i + 1}. {r.event_id ?? "No event ID"}
                    </b>
                    <Badge status={r.status} />
                  </div>
                  <p>{r.message}</p>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="panel records">
          <div className="panel-title">
            <h2>Event review</h2>
            <span className="muted">PostgreSQL</span>
          </div>
          <div className="tabs" role="tablist">
            {(["pending", "exceptions"] as const).map((v) => (
              <button
                role="tab"
                aria-selected={view === v}
                className={view === v ? "active" : ""}
                key={v}
                onClick={() => setView(v)}
              >
                {v === "pending" ? "Pending ACK" : "Exceptions"} (
                {v === "pending" ? pending.length : exceptions.length})
              </button>
            ))}
          </div>
          {view === "pending" && (
            <div className="ack-bar">
              <label>
                <input
                  type="checkbox"
                  disabled={!selectable.length || busy}
                  checked={
                    !!selectable.length &&
                    selectable.every((r) => selected.has(key(r)))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(selectable.map(key))
                        : new Set(),
                    )
                  }
                />{" "}
                Select all COUNTs
              </label>
              <button
                className="solid"
                disabled={!selected.size || busy}
                onClick={() => void ack()}
              >
                ACK selected ({selected.size})
              </button>
            </div>
          )}
          {rows.length === 0 ? (
            <div className="empty">
              {loading && !summary
                ? "Loading database records…"
                : view === "pending"
                  ? "No events awaiting acknowledgement."
                  : "No exceptions for this source."}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {view === "pending" && <th>Select</th>}
                    <th>Event / Source</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>{view === "pending" ? "Details" : "Reason"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={key(row) + i}>
                      {view === "pending" && (
                        <td>
                          <input
                            aria-label={
                              "Select " +
                              row.event_id +
                              " from " +
                              row.source_id
                            }
                            type="checkbox"
                            disabled={row.type !== "COUNT" || busy}
                            checked={selected.has(key(row))}
                            onChange={(e) =>
                              setSelected((old) => {
                                const next = new Set(old);
                                e.target.checked
                                  ? next.add(key(row))
                                  : next.delete(key(row));
                                return next;
                              })
                            }
                          />
                        </td>
                      )}
                      <td>
                        <b>{row.event_id ?? "No ID"}</b>
                        <small>{row.source_id ?? "No source"}</small>
                      </td>
                      <td>{row.type ?? "—"}</td>
                      <td>
                        <Badge status={row.status} />
                      </td>
                      <td>
                        {view === "pending" ? (
                          <>
                            {row.quantity} units
                            {row.reversed_by && (
                              <small>
                                Reversed by VOID · ACK still available
                              </small>
                            )}
                            <small>
                              {row.event_time
                                ? new Date(row.event_time).toLocaleString()
                                : ""}
                            </small>
                          </>
                        ) : (
                          row.message
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <section className="panel mqtt">
        <div className="panel-title">
          <h2>MQTT simulator</h2>
          <Badge
            status={
              !mqtt
                ? "LOADING"
                : !mqtt.enabled
                  ? "DISABLED"
                  : mqtt.connected
                    ? "CONNECTED"
                    : "DISCONNECTED"
            }
          />
        </div>
        <dl>
          {[
            ["Candidate ID", mqtt?.candidate_id ?? "Not configured"],
            ["Last challenge", mqtt?.last_challenge_id ?? "None received"],
            [
              "Challenge time",
              mqtt?.last_challenge_time
                ? new Date(mqtt.last_challenge_time).toLocaleString()
                : "—",
            ],
            ["Response status", mqtt?.response_status ?? "—"],
            ["Stored challenges", mqtt?.challenge_count ?? "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {(mqtt?.last_error || mqtt?.connection_error) && (
          <p className="mqtt-error">
            {mqtt.connection_error || mqtt.last_error}
          </p>
        )}
        {mqtt && !mqtt.enabled && (
          <p className="muted">
            Set the examiner-assigned CANDIDATE_ID in .env and restart the
            backend to connect.
          </p>
        )}
      </section>
      <footer>
        Production Event Dashboard · Totals and history loaded from PostgreSQL
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
