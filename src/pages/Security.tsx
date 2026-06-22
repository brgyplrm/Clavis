import { useState, useMemo } from "react";
import { 
  ShieldAlert, RefreshCw, BarChart, Globe, Smartphone, Clock, BarChart2, 
  ChevronDown, ChevronUp, Check 
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { avatarColor, initials } from "./Dashboard";
import { useVaultStore } from "../hooks/useVaultStore";
import { EntrySummary } from "../lib/tauri";

interface ReportItem {
  id: string;
  title: string;
  username: string;
  badgeText: string;
}

interface ReportSection {
  id: string;
  title: string;
  icon: any;
  count: number;
  color: string;
  items: ReportItem[];
  actionLabel: string;
}

const isOld = (updatedAt: number) => {
  const nowSec = Date.now() / 1000;
  const ts = updatedAt > 1000000000000 ? updatedAt / 1000 : updatedAt;
  return nowSec - ts > 90 * 24 * 3600;
};

const getDaysAgo = (updatedAt: number) => {
  const nowSec = Date.now() / 1000;
  const ts = updatedAt > 1000000000000 ? updatedAt / 1000 : updatedAt;
  const diffSec = nowSec - ts;
  return Math.max(0, Math.floor(diffSec / (24 * 3600)));
};

export default function Security() {
  const { entries } = useVaultStore();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [lastScanned, setLastScanned] = useState<string>(() => new Date().toLocaleString());
  const [scanning, setScanning] = useState(false);

  const sectionsData = useMemo<ReportSection[]>(() => {
    const breachedMap = JSON.parse(localStorage.getItem("clavis_password_breached") || "{}");
    const scoreMap = JSON.parse(localStorage.getItem("clavis_password_scores") || "{}");
    const hashMap = JSON.parse(localStorage.getItem("clavis_password_hashes") || "{}");
    const urlMap = JSON.parse(localStorage.getItem("clavis_urls") || "{}");

    // Exposed
    const exposedItems = entries.filter((e: EntrySummary) => breachedMap[e.id]).map((e: EntrySummary) => ({
      id: e.id,
      title: e.title,
      username: e.username || "No username",
      badgeText: "seen in known data leaks"
    }));

    // Reused
    const reusedItems = entries.filter((e: EntrySummary) => {
      const myHash = hashMap[e.id];
      if (!myHash) return false;
      return Object.entries(hashMap).some(([eid, h]) => eid !== e.id && h === myHash);
    }).map((e: EntrySummary) => {
      const myHash = hashMap[e.id];
      const count = Object.values(hashMap).filter(h => h === myHash).length;
      return {
        id: e.id,
        title: e.title,
        username: e.username || "No username",
        badgeText: `Shared with ${count} entries`
      };
    });

    // Weak
    const weakItems = entries.filter((e: EntrySummary) => {
      const sc = scoreMap[e.id];
      return sc !== undefined && sc <= 1;
    }).map((e: EntrySummary) => ({
      id: e.id,
      title: e.title,
      username: e.username || "No username",
      badgeText: `Strength: Very weak (${scoreMap[e.id]}/4)`
    }));

    // Unsecure
    const unsecureItems = entries.filter((e: EntrySummary) => {
      const u = urlMap[e.id];
      return u && u.startsWith("http://");
    }).map((e: EntrySummary) => ({
      id: e.id,
      title: e.title,
      username: e.username || "No username",
      badgeText: "Uses http:// instead of https://"
    }));

    // Inactive 2FA
    const inactive2faItems = entries.filter((e: EntrySummary) => !e.has_totp).map((e: EntrySummary) => ({
      id: e.id,
      title: e.title,
      username: e.username || "No username",
      badgeText: "2FA not set up"
    }));

    // Old
    const oldItems = entries.filter((e: EntrySummary) => isOld(e.updated_at)).map((e: EntrySummary) => ({
      id: e.id,
      title: e.title,
      username: e.username || "No username",
      badgeText: `Last changed ${getDaysAgo(e.updated_at)} days ago`
    }));

    // Low Entropy
    const lowEntropyItems = entries.filter((e: EntrySummary) => {
      const sc = scoreMap[e.id];
      return sc !== undefined && sc <= 2;
    }).map((e: EntrySummary) => ({
      id: e.id,
      title: e.title,
      username: e.username || "No username",
      badgeText: `Score ${scoreMap[e.id]}/4 — Easy to guess`
    }));

    return [
      {
        id: "exposed",
        title: "Exposed passwords",
        icon: ShieldAlert,
        count: exposedItems.length,
        color: "text-danger",
        actionLabel: "Change password",
        items: exposedItems
      },
      {
        id: "reused",
        title: "Reused passwords",
        icon: RefreshCw,
        count: reusedItems.length,
        color: "text-amber",
        actionLabel: "Change password",
        items: reusedItems
      },
      {
        id: "weak",
        title: "Weak passwords",
        icon: BarChart,
        count: weakItems.length,
        color: "text-amber",
        actionLabel: "Change password",
        items: weakItems
      },
      {
        id: "unsecure",
        title: "Unsecure websites",
        icon: Globe,
        count: unsecureItems.length,
        color: "text-amber",
        actionLabel: "Update URL",
        items: unsecureItems
      },
      {
        id: "inactive2fa",
        title: "Inactive 2FA",
        icon: Smartphone,
        count: inactive2faItems.length,
        color: "text-purple",
        actionLabel: "Add TOTP",
        items: inactive2faItems
      },
      {
        id: "old",
        title: "Old passwords",
        icon: Clock,
        count: oldItems.length,
        color: "text-amber",
        actionLabel: "Change password",
        items: oldItems
      },
      {
        id: "lowentropy",
        title: "Low entropy passwords",
        icon: BarChart2,
        count: lowEntropyItems.length,
        color: "text-purple",
        actionLabel: "Change password",
        items: lowEntropyItems
      }
    ];
  }, [entries]);

  const toggleSection = (id: string) => {
    setOpenSections(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleRunChecks = () => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      setLastScanned(new Date().toLocaleString());
    }, 1200);
  };

  return (
    <div className="flex h-screen flex-1 flex-col min-w-0 bg-background text-foreground overflow-y-auto">
      {/* Top Bar */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <h1 className="text-sm font-semibold">Security</h1>
        <Button 
          onClick={handleRunChecks}
          disabled={scanning}
          className="h-8 text-xs bg-purple text-white hover:bg-purple/90"
        >
          {scanning ? "Running checks..." : "Run all checks"}
        </Button>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {/* Stat Cards - Horizontal Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {sectionsData.map((sec: ReportSection) => {
            const Icon = sec.icon;
            return (
              <div key={sec.id} className="rounded-lg border border-border bg-card p-3 flex flex-col justify-between h-24">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Icon size={12} className={sec.color} />
                  <span className="truncate">{sec.title.split(" ")[0]}</span>
                </div>
                <div className="flex items-end justify-between mt-2">
                  <span className={cn("text-2xl font-bold tabular-nums", sec.count > 0 ? sec.color : "text-teal")}>
                    {sec.count === 0 ? (
                      <Check className="h-6 w-6 text-teal" />
                    ) : (
                      sec.count
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Report list */}
        <div className="space-y-3">
          {sectionsData.map((sec: ReportSection) => {
            const Icon = sec.icon;
            const isOpen = !!openSections[sec.id];
            return (
              <div key={sec.id} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(sec.id)}
                  className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Icon size={16} className={sec.color} />
                    <span className="text-xs font-semibold">{sec.title}</span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold tabular-nums",
                      sec.count > 0 ? "bg-purple-soft text-purple" : "bg-teal/10 text-teal"
                    )}>
                      {sec.count}
                    </span>
                  </div>
                  {isOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>

                {/* Expanded Items */}
                {isOpen && (
                  <div className="border-t border-border divide-y divide-border bg-background">
                    {sec.items.map((item: ReportItem) => (
                      <div key={item.id} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                        <div
                          className="flex shrink-0 items-center justify-center rounded-full font-bold text-white text-[10px]"
                          style={{ background: avatarColor(item.title), width: 28, height: 28 }}
                        >
                          {initials(item.title)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground truncate">{item.title}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{item.username}</div>
                        </div>

                        {/* Muted label details */}
                        <div className="text-[10px] text-muted-foreground font-medium px-4">
                          {item.badgeText}
                        </div>

                        <Button 
                          size="sm" 
                          variant="outline"
                          className="h-7 text-[10px] shrink-0 border-purple/30 text-purple hover:bg-purple-soft"
                          onClick={() => alert(`Redirect to update ${item.title} password`)}
                        >
                          {sec.actionLabel}
                        </Button>
                      </div>
                    ))}
                    {sec.items.length === 0 && (
                      <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <Check size={14} className="text-teal" />
                        No issues found in this category.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pinned scan timestamp */}
      <footer className="py-4 border-t border-border text-center shrink-0">
        <p className="text-[10px] text-muted-foreground">
          Last scanned: {lastScanned}
        </p>
      </footer>
    </div>
  );
}
