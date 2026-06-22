import { useState, useMemo, useEffect } from "react";
import { ScrollText, Download } from "lucide-react";
import { cn } from "../lib/utils";

interface LogRow {
  timestamp: string;
  event: "Unlocked" | "Viewed" | "Copied" | "Failed unlock" | "Entry added" | "Entry deleted";
  entry: string;
  details: string;
}

const FILTER_PILLS = [
  { id: "all", label: "All" },
  { id: "Unlocked", label: "Unlocks" },
  { id: "Viewed", label: "Views" },
  { id: "Copied", label: "Copies" },
  { id: "Failed unlock", label: "Failed attempts" },
  { id: "Changes", label: "Changes" },
];

export default function ActivityLog() {
  const [dateFilter, setDateFilter] = useState("all-time");
  const [activePill, setActivePill] = useState("all");
  const [logs, setLogs] = useState<LogRow[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("clavis_activity_log") || "[]");
      setLogs(stored);
    } catch {
      setLogs([]);
    }
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (activePill === "all") return true;
      if (activePill === "Changes") {
        return log.event === "Entry added" || log.event === "Entry deleted";
      }
      return log.event === activePill;
    });
  }, [logs, activePill]);

  const getEventBadgeClass = (event: LogRow["event"]) => {
    switch (event) {
      case "Unlocked":
        return "bg-teal/10 text-teal border-teal/20";
      case "Viewed":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "Copied":
        return "bg-purple-soft text-purple border-purple-soft/50";
      case "Failed unlock":
        return "bg-danger/10 text-danger border-danger/20";
      case "Entry added":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "Entry deleted":
        return "bg-amber/10 text-amber border-amber/20";
    }
  };

  return (
    <div className="flex h-screen flex-1 flex-col min-w-0 bg-background text-foreground">
      {/* Top Bar */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-purple" />
          <h1 className="text-sm font-semibold">Activity</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="today">Today</option>
            <option value="7days">Last 7 days</option>
            <option value="30days">Last 30 days</option>
            <option value="all-time">All time</option>
          </select>
          <button className="flex h-8 items-center gap-1 rounded-lg border border-border bg-transparent px-3 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <Download size={12} />
            <span>Export log</span>
          </button>
        </div>
      </header>

      {/* Pill Filters */}
      <div className="flex gap-1.5 px-6 py-3 border-b border-border shrink-0">
        {FILTER_PILLS.map((pill) => {
          const active = activePill === pill.id;
          return (
            <button
              key={pill.id}
              onClick={() => setActivePill(pill.id)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors border",
                active
                  ? "bg-purple text-white border-purple"
                  : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted"
              )}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      {/* Logs Table */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filteredLogs.length > 0 ? (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Event</th>
                  <th className="px-4 py-2.5">Entry</th>
                  <th className="px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLogs.map((log, i) => (
                  <tr 
                    key={i} 
                    className={cn(
                      "text-xs transition-colors hover:bg-muted/10",
                      i % 2 === 1 && "bg-muted/20"
                    )}
                  >
                    <td className="px-4 py-3 text-[11px] font-medium text-muted-foreground tabular-nums whitespace-nowrap">
                      {log.timestamp}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold",
                        getEventBadgeClass(log.event)
                      )}>
                        {log.event}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {log.entry}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
            <h3 className="text-xs font-semibold text-foreground">No activity recorded yet</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Activity is logged automatically as you use PassVault.
            </p>
          </div>
        )}
      </div>

      {/* Pinned Footer Note */}
      <footer className="py-3 border-t border-border shrink-0 text-center">
        <p className="text-[10px] text-muted-foreground">
          Stored in a separate encrypted database. This log cannot be edited or deleted.
        </p>
      </footer>
    </div>
  );
}
