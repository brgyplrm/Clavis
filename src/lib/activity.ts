export interface LogRow {
  timestamp: string;
  event: 
    | "Unlocked" 
    | "Viewed" 
    | "Copied" 
    | "Failed unlock" 
    | "Entry added" 
    | "Entry deleted"
    | "Imported"
    | "Backup created"
    | "Backup restored"
    | "Password changed"
    | "Setting changed"
    | "Blocklist modified"
    | "Quick unlock set"
    | "Quick unlock disabled";
  entry: string;
  details: string;
}

export function logEvent(
  event: LogRow["event"],
  entry: string = "—",
  details: string = "—"
) {
  try {
    const logs: LogRow[] = JSON.parse(localStorage.getItem("clavis_activity_log") || "[]");
    
    // Format timestamp like "Jun 15, 2026 23:41"
    const options: Intl.DateTimeFormatOptions = { 
      month: 'short', 
      day: '2-digit', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: false 
    };
    
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', options).replace(',', '');
    
    const newLog: LogRow = {
      timestamp: dateStr,
      event,
      entry,
      details
    };
    
    // Cap log history at 500 entries to prevent storage bloat
    const updated = [newLog, ...logs].slice(0, 500);
    localStorage.setItem("clavis_activity_log", JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to write activity log:", err);
  }
}
