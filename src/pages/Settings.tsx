import { useState } from "react";
import { 
  Settings as SettingsIcon, Shield, Database, RefreshCw, Info, 
  RefreshCw as LoopIcon, Check, AlertTriangle, Eye, EyeOff, X 
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { StrengthBar } from "./Setup";
import { scorePassword } from "../lib/passwordStrength";
import { useVaultStore } from "../hooks/useVaultStore";

const timeoutToSeconds = (val: string): number => {
  switch (val) {
    case "1 min": return 60;
    case "5 min": return 300;
    case "15 min": return 900;
    case "30 min": return 1800;
    default: return 0; // Never
  }
};

const secondsToTimeout = (seconds: number): string => {
  switch (seconds) {
    case 60: return "1 min";
    case 300: return "5 min";
    case 900: return "15 min";
    case 1800: return "30 min";
    default: return "Never";
  }
};

const TABS = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "security", label: "Security", icon: Shield },
  { id: "import-export", label: "Import & Export", icon: Database },
  { id: "backup", label: "Backup", icon: RefreshCw },
  { id: "about", label: "About", icon: Info },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState("general");
  const [changePwOpen, setChangePwOpen] = useState(false);

  // Bind settings from the real Zustand database store
  const { idleTimeout, lockOnFocusLost, updateSetting } = useVaultStore();

  // General States
  const [clipboardDelay, setClipboardDelay] = useState("30s");
  const [theme, setTheme] = useState("Dark");

  // Security States
  const [lockOnScreenLock, setLockOnScreenLock] = useState(true);
  const [lockOnExtDisconnect, setLockOnExtDisconnect] = useState(true);
  const [autotypeDelay, setAutotypeDelay] = useState("3s");
  
  // Master Password Form States
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const { checks: newPwChecks, score: newPwScore } = scorePassword(newPw);
  const newPwAllMet = Object.values(newPwChecks).every(Boolean) && newPw === newPwConfirm && newPw.length > 0;

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== newPwConfirm) return;
    setPwError(null);
    try {
      // Mock successful password change
      alert("Master password updated successfully! Re-encrypting vault complete.");
      setChangePwOpen(false);
      setOldPw("");
      setNewPw("");
      setNewPwConfirm("");
    } catch (err: any) {
      setPwError(err.message || String(err));
    }
  };

  return (
    <div className="flex h-screen flex-1 flex-col bg-background text-foreground overflow-hidden select-none">
      {/* Top Bar */}
      <header className="flex h-16 items-center border-b border-border px-6 shrink-0">
        <h1 className="text-sm font-semibold">Settings</h1>
      </header>

      {/* Main Settings Panel - 2 Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Category Tabs list */}
        <aside className="w-40 shrink-0 border-r border-border bg-sidebar/30 p-2 space-y-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors",
                  active 
                    ? "bg-purple text-white" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Right Column: Settings Content */}
        <main className="flex-1 overflow-y-auto p-6 max-w-2xl">
          {activeTab === "general" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold mb-1">General Settings</h2>
                <p className="text-xs text-muted-foreground">Adjust display themes and general clipboard behaviors.</p>
              </div>

              <div className="divide-y divide-border border border-border rounded-lg bg-card overflow-hidden">
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Auto-lock timeout</span>
                    <span className="text-[10px] text-muted-foreground">Automatically lock vault when inactive</span>
                  </div>
                  <select
                    value={secondsToTimeout(idleTimeout)}
                    onChange={async e => {
                      const secs = timeoutToSeconds(e.target.value);
                      await updateSetting("idle_timeout", secs.toString());
                    }}
                    className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-none"
                  >
                    <option value="1 min">1 min</option>
                    <option value="5 min">5 min</option>
                    <option value="15 min">15 min</option>
                    <option value="30 min">30 min</option>
                    <option value="Never">Never</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Clipboard clear delay</span>
                    <span className="text-[10px] text-muted-foreground">Automatically wipe copied passwords</span>
                  </div>
                  <select
                    value={clipboardDelay}
                    onChange={e => setClipboardDelay(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-none"
                  >
                    <option value="15s">15 seconds</option>
                    <option value="30s">30 seconds</option>
                    <option value="60s">60 seconds</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Theme</span>
                    <span className="text-[10px] text-muted-foreground">Select system appearance preference</span>
                  </div>
                  <div className="flex rounded-lg border border-border overflow-hidden bg-background">
                    {["Light", "Dark", "System"].map(t => {
                      const active = theme === t;
                      return (
                        <button
                          key={t}
                          onClick={() => setTheme(t)}
                          className={cn(
                            "px-3 py-1.5 text-[10px] font-semibold transition-colors",
                            active ? "bg-purple text-white" : "hover:bg-muted text-muted-foreground"
                          )}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Vault file location</span>
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-xs block mt-0.5">
                      ~/.local/share/com.achyllisss.clavis/vault.db
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 text-xs font-semibold text-purple hover:bg-purple-soft/40">
                    Change location
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "security" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold mb-1">Security Settings</h2>
                <p className="text-xs text-muted-foreground">Configure session timeouts, extension linkings, and lock variables.</p>
              </div>

              <div className="divide-y divide-border border border-border rounded-lg bg-card overflow-hidden">
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Change master password</span>
                    <span className="text-[10px] text-muted-foreground">Set a new secure master password for the vault</span>
                  </div>
                  <Button 
                    onClick={() => setChangePwOpen(true)}
                    className="h-8 text-xs bg-purple text-white hover:bg-purple/90"
                  >
                    Change password
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">WebSocket session token</span>
                    <span className="text-[10px] text-muted-foreground font-mono block mt-0.5">
                      ••••••••••••••••••••••••••••••••
                    </span>
                  </div>
                  <button 
                    onClick={() => alert("Token regenerated!")}
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <LoopIcon size={14} />
                  </button>
                </div>

                {/* Lock on screen lock toggle */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Lock on screen lock</span>
                    <span className="text-[10px] text-muted-foreground">Lock vault if the system screen is locked</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={lockOnScreenLock}
                    onChange={(e) => setLockOnScreenLock(e.target.checked)}
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer"
                  />
                </div>

                {/* Lock on idle toggle + nested dropdown */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Lock on idle</span>
                    <span className="text-[10px] text-muted-foreground">Lock vault after user inactivity timeout</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {idleTimeout > 0 && (
                      <select
                        value={secondsToTimeout(idleTimeout)}
                        onChange={async e => {
                          const secs = timeoutToSeconds(e.target.value);
                          await updateSetting("idle_timeout", secs.toString());
                        }}
                        className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none"
                      >
                        <option value="1 min">1 min</option>
                        <option value="5 min">5 min</option>
                        <option value="15 min">15 min</option>
                        <option value="30 min">30 min</option>
                      </select>
                    )}
                    <input
                      type="checkbox"
                      checked={idleTimeout > 0}
                      onChange={async (e) => {
                        const val = e.target.checked ? "300" : "0";
                        await updateSetting("idle_timeout", val);
                      }}
                      className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer"
                    />
                  </div>
                </div>

                {/* Lock on app focus lost */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Lock on focus lost</span>
                    <span className="text-[10px] text-muted-foreground">Lock vault when the application loses window focus</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={lockOnFocusLost}
                    onChange={async (e) => {
                      await updateSetting("lock_on_focus_lost", e.target.checked ? "true" : "false");
                    }}
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer"
                  />
                </div>

                {/* Lock when extension disconnects toggle */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Lock when extension disconnects</span>
                    <span className="text-[10px] text-muted-foreground">Automatically lock vault if helper extension logs out</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={lockOnExtDisconnect}
                    onChange={(e) => setLockOnExtDisconnect(e.target.checked)}
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer"
                  />
                </div>

                {/* Active session readout */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Active session</span>
                    <span className="text-[10px] text-muted-foreground">Remaining vault unlock duration state</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-green-500 shadow-md shadow-green-500/20" />
                    <span>Unlocked for 12 minutes</span>
                  </div>
                </div>

                {/* Autotype delay row */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Autotype delay</span>
                    <span className="text-[10px] text-muted-foreground">Time window before keystroke generation begins</span>
                  </div>
                  <select
                    value={autotypeDelay}
                    onChange={e => setAutotypeDelay(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-none"
                  >
                    <option value="2s">2 seconds</option>
                    <option value="3s">3 seconds</option>
                    <option value="5s">5 seconds</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Browser extension status</span>
                    <span className="text-[10px] text-muted-foreground">WebSocket connector indicator</span>
                  </div>
                  <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-semibold text-teal border border-teal/20">
                    Connected
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "import-export" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold mb-1">Import & Export</h2>
                <p className="text-xs text-muted-foreground">Retrieve or transition credentials to/from other applications.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Import Card */}
                <div className="border border-border rounded-lg bg-card p-4 space-y-3.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-foreground">Import Credentials</h3>
                    <div className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-purple/40 bg-background/50">
                      <span className="text-[10px] text-muted-foreground">Drop backup file or browse</span>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-muted-foreground">File Format</label>
                      <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none">
                        <option>CSV Format</option>
                        <option>Bitwarden JSON</option>
                        <option>1Password 1PUX</option>
                      </select>
                    </div>
                  </div>
                  <Button className="w-full h-8 text-xs bg-purple text-white hover:bg-purple/90">Import</Button>
                </div>

                {/* Export Card */}
                <div className="border border-border rounded-lg bg-card p-4 space-y-3.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-foreground">Export Credentials</h3>
                    <div className="flex gap-2 p-3 bg-danger/5 border border-danger/15 rounded-lg text-[10px] text-danger">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>Warning: Exports are encrypted but handle backups securely.</span>
                    </div>
                  </div>
                  <Button variant="outline" className="w-full h-8 text-xs border-danger/30 text-danger hover:bg-danger/10">
                    Export vault
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "backup" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold mb-1">Backup Settings</h2>
                <p className="text-xs text-muted-foreground">Configure auto backups and manual database exports.</p>
              </div>

              <div className="divide-y divide-border border border-border rounded-lg bg-card overflow-hidden">
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Back up vault now</span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Last backup: Jun 21, 2026 18:22</span>
                  </div>
                  <Button className="h-8 text-xs bg-purple text-white hover:bg-purple/90">
                    Back up now
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Auto-backup</span>
                    <span className="text-[10px] text-muted-foreground">Automatically write database backups daily</span>
                  </div>
                  <input
                    type="checkbox"
                    defaultChecked
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "about" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold mb-1">About PassVault</h2>
                <p className="text-xs text-muted-foreground">System descriptors and package check states.</p>
              </div>

              <div className="divide-y divide-border border border-border rounded-lg bg-card overflow-hidden">
                <div className="flex justify-between p-4 text-xs">
                  <span className="font-medium text-muted-foreground">App version</span>
                  <span className="font-semibold">v0.1.0 (clavis)</span>
                </div>
                <div className="flex justify-between p-4 text-xs">
                  <span className="font-medium text-muted-foreground">Tauri version</span>
                  <span className="font-semibold">v2.0.0-rc</span>
                </div>
                <div className="flex justify-between items-center p-4 text-xs">
                  <span className="font-medium text-muted-foreground">cargo audit status</span>
                  <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal border border-teal/20">
                    Passing
                  </span>
                </div>
                <div className="flex justify-between p-4 text-xs">
                  <span className="font-medium text-muted-foreground">GitHub Repository</span>
                  <a href="https://github.com" target="_blank" rel="noreferrer" className="text-purple hover:underline font-semibold">
                    github.com/clavis
                  </a>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* CHANGE MASTER PASSWORD DIALOG */}
      {changePwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <form onSubmit={handleChangePassword} className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 animate-fade-in text-foreground">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <h2 className="text-sm font-semibold">Change master password</h2>
              <button 
                type="button" 
                onClick={() => setChangePwOpen(false)} 
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {pwError && (
              <p className="text-xs text-danger bg-danger/10 border border-danger/20 p-2 rounded-lg">{pwError}</p>
            )}

            {/* Warning Banner */}
            <div className="flex gap-2.5 p-3 bg-danger/5 border border-danger/15 rounded-lg text-xs text-danger">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>This will re-encrypt your entire vault. Do not close the app during this process.</span>
            </div>

            <div className="space-y-3">
              {/* Current Password */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Current Password</label>
                <div className="relative">
                  <Input
                    type={showOld ? "text" : "password"}
                    value={oldPw}
                    onChange={e => setOldPw(e.target.value)}
                    placeholder="Enter current password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowOld(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showOld ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">New Password</label>
                <div className="relative">
                  <Input
                    type={showNew ? "text" : "password"}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    placeholder="Enter new password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Confirm New Password */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Confirm New Password</label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={newPwConfirm}
                    onChange={e => setNewPwConfirm(e.target.value)}
                    placeholder="Confirm new password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <StrengthBar password={newPw} />
              
              {/* Requirements Checklist */}
              <ul className="grid grid-cols-2 gap-1.5 pt-1 text-xs">
                {[
                  ["12+ characters", newPwChecks.length],
                  ["Uppercase letter", newPwChecks.upper],
                  ["Lowercase letter", newPwChecks.lower],
                  ["Number", newPwChecks.number],
                  ["Symbol", newPwChecks.symbol],
                ].map(([label, ok]) => (
                  <li key={label as string} className={cn("flex items-center gap-1.5 transition-colors duration-300", ok ? "text-teal" : "text-muted-foreground")}>
                    <Check size={12} className={cn("transition-opacity duration-300", ok ? "opacity-100" : "opacity-30")} />
                    {label}
                  </li>
                ))}
              </ul>
              {newPw && newPwConfirm && newPw !== newPwConfirm && (
                <p className="text-xs text-danger">Passwords do not match</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setChangePwOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={!newPwAllMet || newPwScore < 3}
                className="text-xs bg-purple text-white hover:bg-purple/90"
              >
                Update password
              </Button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
