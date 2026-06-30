import { useState, useMemo, useEffect } from "react";
import { 
  BookOpen, Search, ChevronDown, ChevronUp, Check, 
  AlertTriangle, ShieldCheck
} from "lucide-react";
import { cn } from "../lib/utils";
import { useVaultStore } from "../hooks/useVaultStore";

interface HelpArticle {
  title: string;
  category: "guide" | "reference" | "security" | "troubleshooting";
  content: string;
}

const HELP_ARTICLES: HelpArticle[] = [
  {
    category: "guide",
    title: "How to add a password entry",
    content: "To add a password entry, go to the **Dashboard** and click the purple **+ (Add Entry)** button. Fill in the Title, Username, and Password. You can also specify an optional website URL and TOTP secret key for 2FA. Once you click Save, the entry will be encrypted and saved locally in your database."
  },
  {
    category: "guide",
    title: "How to reveal and copy a password",
    content: "Select any entry on the Dashboard to open the detail panel on the right. To view the password, click the eye icon (👁️). The password will re-hide automatically after 10 seconds. To copy the password, click the Copy icon. For security, Clavis automatically clears your clipboard after 30 seconds to prevent password leakage."
  },
  {
    category: "guide",
    title: "How to set up 2FA (TOTP)",
    content: "When editing or creating an entry, enter the raw secret key provided by the website (e.g. `JBSWY3DPEHPK3PXP`) into the **TOTP Secret** field. Clavis will parse this key and generate 6-digit verification codes that rotate every 30 seconds. You can view these directly in the entry details or on the dedicated **Authenticator** tab."
  },
  {
    category: "guide",
    title: "How to use Autotype",
    content: "Autotype lets you log in without copying anything. Simply click into a username input field in any website or app, press `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac), and Clavis will open an account picker. Select the entry, and Clavis will emulate your keyboard to type the username and password automatically."
  },
  {
    category: "guide",
    title: "How to install and use the browser extension",
    content: "Install the Clavis browser extension from the Chrome Web Store or Firefox Add-ons. Ensure Clavis is running on your desktop. The extension communicates securely over local WebSockets to autofill credentials and prompt to save newly created accounts."
  },
  {
    category: "guide",
    title: "How to set up automatic backups",
    content: "Navigate to **Settings** → **Backup**. Specify a target directory and a backup interval (e.g. Daily or Weekly). Clavis will automatically compile secure snapshots of your database. You can also click **Backup Now** to save a snapshot immediately."
  },
  {
    category: "guide",
    title: "How to change your master password",
    content: "Navigate to **Settings** → **Security** and click **Change Master Password**. Enter your current password followed by your new password. Rekeying re-encrypts the entire database with a new AES key derived via Argon2id."
  },
  {
    category: "reference",
    title: "Dashboard Overview",
    content: "The Dashboard is the control hub of Clavis. The left column lists your vault partitions, the center column lists entries matching search queries, and the right panel presents details and file attachments."
  },
  {
    category: "reference",
    title: "Settings Tab Guide",
    content: "* **General**: Configure startup parameters and theme preferences.\n* **Security**: Manage auto-lock idle timeout, clipboard delay, and master credentials.\n* **Browser Extension**: View connection logs and blocklisted domains.\n* **Backup**: Schedule database snapshot paths and retention rules."
  },
  {
    category: "security",
    title: "How Clavis encrypts your data",
    content: "Clavis operates entirely offline. Your master password is ran through Argon2id KDF to derive a 256-bit key. Your credentials and TOTP secrets are encrypted using authenticated AES-256-GCM. The encryption key never leaves system memory."
  },
  {
    category: "security",
    title: "What happens if I forget my master password?",
    content: "Clavis is a zero-knowledge password manager. If you forget your master password and do not have your recovery security answers set up, **your data cannot be recovered**. Store your recovery answers in a secure, physical location."
  },
  {
    category: "security",
    title: "Why Clavis has no cloud sync",
    content: "To guarantee absolute privacy, Clavis stores all data locally. There are no central servers to hack. Backups can be synced manually to secure clouds (such as Proton Drive or personal NAS) by setting the backup directory to a synced folder."
  },
  {
    category: "troubleshooting",
    title: "The browser extension is not connecting",
    content: "Ensure the Clavis desktop app is open and unlocked. The extension communicates over a local WebSocket server (port `59001`). If you have a strict local firewall, verify that connections to localhost are allowed."
  },
  {
    category: "troubleshooting",
    title: "Autotype is not working",
    content: "Autotype emulates a keyboard. On Linux, ensure that your display server is running X11 or has appropriate accessibility permissions if on Wayland. If typing is too fast, increase the autotype delay in Settings → Security."
  }
];

export function useChecklist() {
  const { entries } = useVaultStore();
  const [copied, setCopied] = useState(() => localStorage.getItem("checklist_copied") === "true");
  const [searched, setSearched] = useState(() => localStorage.getItem("checklist_searched") === "true");
  const [backup, setBackup] = useState(() => localStorage.getItem("checklist_backup") === "true");
  const [extension, setExtension] = useState(() => localStorage.getItem("checklist_extension") === "true");
  const [autotype, setAutotype] = useState(() => localStorage.getItem("checklist_autotype") === "true");
  const [crypto, setCrypto] = useState(() => localStorage.getItem("checklist_crypto") === "true");

  const hasEntries = entries.length >= 1;
  const hasTotp = entries.some(e => e.has_totp);

  useEffect(() => {
    const handleStorage = () => {
      setCopied(localStorage.getItem("checklist_copied") === "true");
      setSearched(localStorage.getItem("checklist_searched") === "true");
      setBackup(localStorage.getItem("checklist_backup") === "true");
      setExtension(localStorage.getItem("checklist_extension") === "true");
      setAutotype(localStorage.getItem("checklist_autotype") === "true");
      setCrypto(localStorage.getItem("checklist_crypto") === "true");
    };

    window.addEventListener("storage", handleStorage);
    const interval = setInterval(async () => {
      try {
        const count = await (window as any).tauri?.get_active_connections_count();
        if (count > 0 && !extension) {
          localStorage.setItem("checklist_extension", "true");
          setExtension(true);
        }
      } catch {}
    }, 4000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, [extension]);

  const items = [
    { id: "entries", label: "Add your first password entry", done: hasEntries, link: "dashboard" },
    { id: "copy", label: "Try copying a password (it clears in 30s)", done: copied, link: "dashboard" },
    { id: "search", label: "Try using the search bar", done: searched, link: "dashboard" },
    { id: "backup", label: "Set up a backup (Settings → Backup)", done: backup, link: "settings", tab: "backup" },
    { id: "extension", label: "Install the browser extension", done: extension, link: "settings", tab: "extension" },
    { id: "autotype", label: "Try Autotype — press Ctrl+Shift+V in any app", done: autotype, link: "settings", tab: "security" },
    { id: "totp", label: "Add a TOTP code to an entry (for 2FA)", done: hasTotp, link: "dashboard" },
    { id: "crypto", label: "Explore the Crypto Vault section", done: crypto, link: "settings", tab: "general" },
  ];

  const completedCount = items.filter(i => i.done).length;
  const progressPercent = Math.round((completedCount / items.length) * 100);

  return { items, completedCount, progressPercent };
}

export default function Help() {
  const { setCurrentView, setActiveSettingsTab } = useVaultStore();
  const { items, completedCount, progressPercent } = useChecklist();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedArticles, setExpandedArticles] = useState<Record<string, boolean>>({});

  const toggleArticle = (title: string) => {
    setExpandedArticles(prev => ({ ...prev, [title]: !prev[title] }));
  };

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return HELP_ARTICLES;
    return HELP_ARTICLES.filter(a => 
      a.title.toLowerCase().includes(q) || 
      a.content.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleLinkClick = (link: string, tab?: string) => {
    if (tab) {
      setActiveSettingsTab(tab);
    }
    setCurrentView(link as any);
  };

  return (
    <div className="flex h-screen flex-1 flex-col bg-background text-foreground overflow-y-auto select-none">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-purple" />
          <h1 className="text-sm font-semibold">Help Center</h1>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search guides and issues..."
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </header>

      <div className="p-6 space-y-6 max-w-4xl">
        {/* Checklist Widget */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Getting Started</h2>
              <p className="text-[11px] text-muted-foreground">Complete these setup steps to get the most out of Clavis.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 shrink-0">
                <svg className="h-full w-full -rotate-90">
                  <circle cx="20" cy="20" r="16" className="stroke-muted/30 fill-none" strokeWidth="3" />
                  <circle 
                    cx="20" cy="20" r="16" 
                    className="stroke-purple fill-none transition-all duration-500" 
                    strokeWidth="3"
                    strokeDasharray="100.5"
                    strokeDashoffset={100.5 - (100.5 * progressPercent) / 100}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold">
                  {completedCount}/8
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {items.map(item => (
              <div 
                key={item.id} 
                onClick={() => handleLinkClick(item.link, item.tab)}
                className={cn(
                  "flex items-center justify-between rounded-lg border p-2.5 text-[11px] transition-colors cursor-pointer",
                  item.done 
                    ? "bg-teal/5 border-teal/20 text-teal/90" 
                    : "bg-muted/15 border-border hover:bg-muted/30 text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    item.done ? "bg-teal/15 border-teal text-teal" : "border-muted-foreground/30"
                  )}>
                    {item.done && <Check size={10} />}
                  </div>
                  <span className="truncate">{item.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Guides Accordions */}
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Knowledge Base</h2>
          
          <div className="space-y-2">
            {filteredArticles.map(article => {
              const isExpanded = !!expandedArticles[article.title];
              return (
                <div key={article.title} className="rounded-lg border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => toggleArticle(article.title)}
                    className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                  >
                    <span className="text-xs font-semibold text-foreground">{article.title}</span>
                    {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1.5 border-t border-border/40 text-[11px] text-muted-foreground leading-relaxed whitespace-pre-line">
                      {article.content}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredArticles.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-8">No articles found matching "{searchQuery}".</p>
            )}
          </div>
        </div>

        {/* Info footer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 border-t border-border/55">
          <div className="rounded-lg border border-border bg-card p-4 flex gap-3 text-xs leading-normal">
            <ShieldCheck size={20} className="text-purple shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-foreground">Need Security Help?</h4>
              <p className="text-muted-foreground text-[11px] mt-1">If you have found a security vulnerability or concern, reach out securely at <strong className="text-purple font-bold">security@clavis.app</strong>.</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 flex gap-3 text-xs leading-normal">
            <AlertTriangle size={20} className="text-amber shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-foreground">System Offline</h4>
              <p className="text-muted-foreground text-[11px] mt-1">Clavis does not connect to the cloud. Your credentials and keys stay 100% locally encrypted on your device.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
