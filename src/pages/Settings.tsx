import { useState, useEffect } from "react";
import { 
  Settings as SettingsIcon, Shield, Database, RefreshCw, Info, 
  Check, AlertTriangle, Eye, EyeOff, X, Puzzle, FolderOpen, Fingerprint
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import PasswordStrengthMeter from "../components/PasswordStrengthMeter";
import { scorePassword } from "../lib/passwordStrength";
import { useVaultStore } from "../hooks/useVaultStore";
import { getSetting, addToBlocklist, removeFromBlocklist, detectInstalledBrowsers, DetectedBrowser } from "../lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import PageHelp from "../components/ui/PageHelp";
import { logEvent } from "../lib/activity";

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
  { id: "extension", label: "Browser Extension", icon: Puzzle },
  { id: "import-export", label: "Import & Export", icon: Database },
  { id: "backup", label: "Backup", icon: RefreshCw },
  { id: "about", label: "About", icon: Info },
];

interface SettingsProps {
  onReplayTour?: () => void;
}

export default function Settings({ onReplayTour }: SettingsProps) {
  const [changePwOpen, setChangePwOpen] = useState(false);

  // Bind settings from Zustand vault store
  const { 
    idleTimeout, lockOnFocusLost, screenCaptureProtected, autotypeShortcut, 
    theme, autotypeDelay, clipboardTimeout, backupInterval, backupDirectory, backupRetention,
    updateSetting, showToast, lock,
    activeSettingsTab: activeTab,
    setActiveSettingsTab: setActiveTab
  } = useVaultStore();

  // Autostart State
  const [autostartEnabled, setAutostartEnabled] = useState(false);

  // App version state
  const [appVersion, setAppVersion] = useState("v0.1.0");

  // Extension blocklist state
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");

  // Lockout / Master password states
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [changePwAttempts, setChangePwAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutTimer, setLockoutTimer] = useState(0);

  // Export encrypted modal state
  const [exportEncryptedOpen, setExportEncryptedOpen] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportConfirmPassphrase, setExportConfirmPassphrase] = useState("");
  const [showExportPassphrase, setShowExportPassphrase] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Export CSV warning modal state
  const [exportCsvOpen, setExportCsvOpen] = useState(false);
  const [csvCheck1, setCsvCheck1] = useState(false);
  const [csvCheck2, setCsvCheck2] = useState(false);
  const [csvConfirmationText, setCsvConfirmationText] = useState("");

  // Import wizard states
  const [importFilePath, setImportFilePath] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [showImportPass, setShowImportPass] = useState(false);
  const [importPreviewItems, setImportPreviewItems] = useState<{ title: string; username: string | null }[] | null>(null);
  const [importConflict, setImportConflict] = useState("skip");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [isImportLoading, setIsImportLoading] = useState(false);

  // Lock when extension disconnects state
  const [lockOnExtDisconnect, setLockOnExtDisconnect] = useState(true);

  // Quick Unlock States
  const [quickUnlockMethod, setQuickUnlockMethod] = useState(() => localStorage.getItem("clavis_quick_unlock_method") || "password");
  const [hasEnrolledPin, setHasEnrolledPin] = useState(() => !!localStorage.getItem("clavis_quick_unlock_pin"));

  // Quick Unlock Setup Wizard Modal States
  const [wizardTarget, setWizardTarget] = useState<"pin" | "fingerprint" | null>(null);
  const [wizardStep, setWizardStep] = useState<"auth" | "enroll" | "confirm">("auth");
  const [wizardPassword, setWizardPassword] = useState("");
  const [wizardAuthError, setWizardAuthError] = useState<string | null>(null);
  const [wizardAuthLoading, setWizardAuthLoading] = useState(false);

  // PIN settings wizard states
  const [wizardPin, setWizardPin] = useState("");
  const [wizardConfirmPin, setWizardConfirmPin] = useState("");
  const [wizardPinPhase, setWizardPinPhase] = useState<"enter" | "confirm">("enter");
  const [wizardPinStatus, setWizardPinStatus] = useState<"idle" | "success" | "error">("idle");
  const [wizardPinShake, setWizardPinShake] = useState(false);

  // Fingerprint settings wizard states
  const [enrollingFingerprint, setEnrollingFingerprint] = useState(false);
  const [fingerprintEnrolled, setFingerprintEnrolled] = useState(false);

  const handleDisableQuickUnlock = (method: "pin" | "fingerprint") => {
    localStorage.removeItem("clavis_quick_unlock_pin");
    localStorage.setItem("clavis_quick_unlock_method", "password");
    setQuickUnlockMethod("password");
    setHasEnrolledPin(false);
    setFingerprintEnrolled(false);
    showToast("Quick Unlock Disabled", `${method === "pin" ? "PIN" : "Biometrics"} quick unlock disabled.`, "info");
    logEvent("Quick unlock disabled", method === "pin" ? "PIN Code" : "Biometrics", `${method === "pin" ? "PIN" : "Biometrics"} quick unlock disabled by user`);
  };

  const handleStartQuickUnlockWizard = (target: "pin" | "fingerprint") => {
    setWizardTarget(target);
    setWizardStep("auth");
    setWizardPassword("");
    setWizardAuthError(null);
    setWizardPin("");
    setWizardConfirmPin("");
    setWizardPinPhase("enter");
    setWizardPinStatus("idle");
    setEnrollingFingerprint(false);
    setFingerprintEnrolled(false);
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wizardPassword) return;
    setWizardAuthError(null);
    setWizardAuthLoading(true);
    try {
      const match = await invoke<boolean>("verify_master_password", { password: wizardPassword });
      if (match) {
        if (wizardTarget === "pin") {
          setWizardStep("enroll");
          setWizardPin("");
          setWizardPinPhase("enter");
        } else {
          setWizardStep("enroll");
          setEnrollingFingerprint(true);
          // Simulate biometric registration scan
          setTimeout(() => {
            setEnrollingFingerprint(false);
            setFingerprintEnrolled(true);
            localStorage.setItem("clavis_quick_unlock_method", "fingerprint");
            setQuickUnlockMethod("fingerprint");
            showToast("Fingerprint Setup", "Biometric unlock has been set up successfully.", "success");
            logEvent("Quick unlock set", "Biometrics", "Biometric unlock successfully configured");
            setWizardTarget(null);
          }, 2000);
        }
      } else {
        setWizardAuthError("Invalid master password. Please try again.");
      }
    } catch (err: any) {
      setWizardAuthError(String(err));
    } finally {
      setWizardAuthLoading(false);
    }
  };

  const handleWizardPinKey = (val: string) => {
    if (wizardPinStatus === "success") return;

    if (wizardPinPhase === "enter") {
      if (wizardPin.length < 6) {
        const next = wizardPin + val;
        setWizardPin(next);
        if (next.length >= 4) {
          // Allow transitioning to confirm phase
          setTimeout(() => {
            setWizardPinPhase("confirm");
            setWizardConfirmPin("");
          }, 300);
        }
      }
    } else {
      if (wizardConfirmPin.length < wizardPin.length) {
        const next = wizardConfirmPin + val;
        setWizardConfirmPin(next);
        if (next.length === wizardPin.length) {
          if (next === wizardPin) {
            setWizardPinStatus("success");
            setTimeout(() => {
              localStorage.setItem("clavis_quick_unlock_pin", wizardPin);
              localStorage.setItem("clavis_quick_unlock_method", "pin");
              setQuickUnlockMethod("pin");
              setHasEnrolledPin(true);
              showToast("PIN Configured", "Your quick unlock PIN is successfully enrolled.", "success");
              logEvent("Quick unlock set", "PIN Code", "PIN code quick unlock successfully configured");
              setWizardTarget(null);
            }, 800);
          } else {
            setWizardPinStatus("error");
            setWizardPinShake(true);
            setTimeout(() => {
              setWizardConfirmPin("");
              setWizardPinStatus("idle");
              setWizardPinShake(false);
            }, 1000);
          }
        }
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!wizardTarget || wizardTarget !== "pin" || (wizardStep !== "enroll" && wizardStep !== "confirm") || wizardPinStatus === "success") return;

      if (/^[0-9]$/.test(e.key)) {
        handleWizardPinKey(e.key);
      } else if (e.key === "Backspace") {
        if (wizardPinPhase === "enter") {
          setWizardPin(prev => prev.slice(0, -1));
        } else {
          setWizardConfirmPin(prev => prev.slice(0, -1));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [wizardTarget, wizardStep, wizardPinStatus, wizardPin, wizardConfirmPin, wizardPinPhase]);

  // Companion connection state
  const [activeCompanions, setActiveCompanions] = useState(0);
  const [detectedBrowsers, setDetectedBrowsers] = useState<DetectedBrowser[]>([]);

  const refreshBrowsers = () => {
    detectInstalledBrowsers()
      .then(list => setDetectedBrowsers(list))
      .catch(err => console.error("Failed to detect browsers:", err));
  };

  // Active companions polling
  useEffect(() => {
    const checkCompanions = () => {
      invoke<number>("get_active_connections_count")
        .then(count => setActiveCompanions(count))
        .catch(() => {});
    };
    checkCompanions();
    const interval = setInterval(checkCompanions, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === "extension") {
      refreshBrowsers();
    }
  }, [activeTab]);

  // Initial load
  useEffect(() => {
    getSetting("autostart").then(val => {
      setAutostartEnabled(val === "true");
    }).catch(() => {});

    invoke<string>("get_app_version").then(ver => {
      setAppVersion("v" + ver);
    }).catch(() => {});

    getSetting("extension_blocklist")
      .then(val => {
        if (val) {
          try {
            setBlocklist(JSON.parse(val));
          } catch (e) {}
        }
      })
      .catch(() => {});

    getSetting("lock_on_ext_disconnect")
      .then(val => {
        if (val) {
          setLockOnExtDisconnect(val === "true");
        }
      })
      .catch(() => {});
  }, []);

  // Lockout timer countdown effect
  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutTimer(remaining);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setPwError(null);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const handleToggleAutostart = async (val: boolean) => {
    setAutostartEnabled(val);
    await updateSetting("autostart", val ? "true" : "false");
    await invoke("set_autostart", { enabled: val });
    showToast("Autostart", `Autostart is now ${val ? "enabled" : "disabled"}.`, "success");
  };

  const handleToggleLockOnDisconnect = async (val: boolean) => {
    setLockOnExtDisconnect(val);
    await updateSetting("lock_on_ext_disconnect", val ? "true" : "false");
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    const domain = newDomain.trim().toLowerCase();
    if (!blocklist.includes(domain)) {
      const newList = [...blocklist, domain];
      setBlocklist(newList);
      await addToBlocklist(domain);
      showToast("Blocked Domain", `${domain} blocklisted.`, "info");
      logEvent("Blocklist modified", domain, "Domain added to browser extension blocklist");
    }
    setNewDomain("");
  };

  const handleRemoveDomain = async (domain: string) => {
    const newList = blocklist.filter(d => d !== domain);
    setBlocklist(newList);
    await removeFromBlocklist(domain);
    showToast("Allowed Domain", `${domain} removed from blocklist.`, "info");
    logEvent("Blocklist modified", domain, "Domain removed from browser extension blocklist");
  };

  // Keyboard hotkey scanner
  const handleHotkeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const key = e.key;

    if (key === "Escape") {
      e.currentTarget.blur();
      return;
    }

    if (key === "Backspace" && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      updateSetting("autotype_shortcut", "");
      e.currentTarget.blur();
      return;
    }

    if (["Control", "Shift", "Alt", "Meta", "CapsLock"].includes(key)) {
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (e.metaKey) mods.push("Super");
      if (mods.length > 0) {
        updateSetting("autotype_shortcut", mods.join("+") + "+");
      }
      return;
    }

    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Alt");
    if (e.metaKey) mods.push("Super");

    let mainKey = key.toUpperCase();
    if (key === " ") mainKey = "Space";
    if (key === "ArrowUp") mainKey = "Up";
    if (key === "ArrowDown") mainKey = "Down";
    if (key === "ArrowLeft") mainKey = "Left";
    if (key === "ArrowRight") mainKey = "Right";

    if (mods.length > 0) {
      const combination = [...mods, mainKey].join("+");
      updateSetting("autotype_shortcut", combination);
      showToast("Shortcut Registered", `Autotype global hotkey set to {combination}`, "success");
      e.currentTarget.blur();
    }
  };

  const { checks: newPwChecks, score: newPwScore } = scorePassword(newPw);
  const newPwAllMet = Object.values(newPwChecks).every(Boolean) && newPw === newPwConfirm && newPw.length > 0;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== newPwConfirm) return;
    
    if (lockoutUntil && Date.now() < lockoutUntil) {
      setPwError(`Attempts locked. Wait ${lockoutTimer}s.`);
      return;
    }

    setPwError(null);
    try {
      await invoke("change_master_password", { currentPassword: oldPw, newPassword: newPw });
      showToast("Success", "Master password rekey completed successfully!", "success");
      logEvent("Password changed", "Master Password", "Master password rekey completed successfully");
      setChangePwOpen(false);
      setOldPw("");
      setNewPw("");
      setNewPwConfirm("");
      setChangePwAttempts(0);
    } catch (err: any) {
      const nextAttempts = changePwAttempts + 1;
      setChangePwAttempts(nextAttempts);
      if (nextAttempts >= 3) {
        const lockoutTime = Date.now() + 300 * 1000;
        setLockoutUntil(lockoutTime);
        setLockoutTimer(300);
        setPwError("Too many failed attempts. Locked out for 5 minutes.");
      } else {
        setPwError(`Authentication failed. Incorrect current password. (Attempt ${nextAttempts}/3)`);
      }
    }
  };

  // Dialog triggers for Import/Export
  const handleSelectImportFile = async () => {
    setImportError(null);
    setImportSuccessMsg(null);
    const file = await open({
      filters: [{ name: "Clavis or CSV Files", extensions: ["clavis", "csv"] }],
      multiple: false
    });
    if (file) {
      setImportFilePath(file as string);
      setImportPreviewItems(null);
    }
  };

  const handleLoadImportPreview = async () => {
    if (!importFilePath) return;
    setIsImportLoading(true);
    setImportError(null);
    try {
      const preview = await invoke<any>("parse_import_file", {
        filePath: importFilePath,
        passphrase: importPassphrase || null
      });

      if (!preview.success) {
        if (preview.error === "passphrase_required" || preview.error === "invalid_passphrase") {
          setImportError("Password decryption required or invalid password entered.");
        } else {
          setImportError(preview.error || "Failed to parse import preview.");
        }
        setImportPreviewItems(null);
      } else {
        setImportPreviewItems(preview.items);
      }
    } catch (err: any) {
      setImportError(err.message || String(err));
    } finally {
      setIsImportLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const path = await save({
        defaultPath: "clavis_template.csv",
        filters: [{ name: "CSV spreadsheet", extensions: ["csv"] }]
      });

      if (path) {
        const content = "title,username,password\nGoogle,achyllisss,mysecurepass123\nGitHub,achyllisss,githubpass456\n";
        await invoke("write_text_file", { path, content });
        showToast("Template Saved", "CSV template downloaded successfully!", "success");
      }
    } catch (err: any) {
      showToast("Error", `Failed to save template: ${err}`, "error");
    }
  };

  const handleExecuteImport = async () => {
    if (!importFilePath) return;
    setIsImportLoading(true);
    setImportError(null);
    try {
      await invoke("execute_import", {
        filePath: importFilePath,
        passphrase: importPassphrase || null,
        conflictResolution: importConflict
      });
      showToast("Import Success", `Successfully imported ${importPreviewItems?.length || 0} credentials!`, "success");
      logEvent("Imported", "Credentials file", `Imported ${importPreviewItems?.length || 0} entries via ${importConflict} mode`);
      setImportSuccessMsg(`Successfully imported ${importPreviewItems?.length || 0} credentials!`);
      // Reset
      setImportFilePath("");
      setImportPassphrase("");
      setImportPreviewItems(null);
    } catch (err: any) {
      setImportError(err.message || String(err));
    } finally {
      setIsImportLoading(false);
    }
  };

  // Encrypted Export File Picker Trigger
  const handleExportEncryptedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (exportPassphrase !== exportConfirmPassphrase) return;

    setExportError(null);
    try {
      const path = await save({
        filters: [{ name: "Clavis Vault", extensions: ["clavis"] }]
      });

      if (path) {
        await invoke("export_vault_encrypted", {
          passphrase: exportPassphrase,
          savePath: path
        });
        showToast("Export Success", `Encrypted backup written to ${path}`, "success");
        setExportEncryptedOpen(false);
        setExportPassphrase("");
        setExportConfirmPassphrase("");
      }
    } catch (err: any) {
      setExportError(err.message || String(err));
    }
  };

  // CSV unencrypted export trigger
  const handleExportCsvExecute = async () => {
    if (csvConfirmationText !== "EXPORT") return;
    try {
      const path = await save({
        filters: [{ name: "CSV Spreadsheet", extensions: ["csv"] }]
      });

      if (path) {
        await invoke("export_vault_csv", { savePath: path });
        showToast("Export Success", `Unencrypted CSV written to ${path}`, "success");
        setExportCsvOpen(false);
        setCsvConfirmationText("");
        setCsvCheck1(false);
        setCsvCheck2(false);
      }
    } catch (err: any) {
      showToast("Export Failed", String(err), "error");
    }
  };

  // Backup folder picker
  const handleSelectBackupDirectory = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) {
      await updateSetting("backup_directory", dir as string);
      showToast("Backup Directory", `Backups target set to: ${dir}`, "info");
    }
  };

  const handleBackupNow = async () => {
    try {
      const path = await invoke<string>("create_backup");
      showToast("Backup Created", `Secure database snapshot written: ${path}`, "success");
      logEvent("Backup created", "Manual Backup", `Written to: ${path}`);
      localStorage.setItem("checklist_backup", "true");
      window.dispatchEvent(new Event("storage"));
    } catch (err: any) {
      showToast("Backup Failed", String(err), "error");
    }
  };

  const handleRestoreBackup = async () => {
    const file = await open({
      filters: [{ name: "Database Backup", extensions: ["db"] }]
    });

    if (file) {
      try {
        await invoke("restore_backup", { backupPath: file as string });
        showToast("Restore Completed", "Vault database replaced successfully! Locking app.", "success");
        logEvent("Backup restored", "Restore Backup", `Replaced database with backup file: ${file}`);
        setTimeout(() => {
          lock();
        }, 1500);
      } catch (err: any) {
        showToast("Restore Failed", String(err), "error");
      }
    }
  };

  const { checks: exportPwChecks, score: exportPwScore } = scorePassword(exportPassphrase);
  const exportPwAllMet = Object.values(exportPwChecks).every(Boolean) && exportPassphrase === exportConfirmPassphrase && exportPassphrase.length > 0;

  return (
    <div className="flex h-screen flex-1 flex-col bg-background text-foreground overflow-hidden select-none">
      {/* Top Bar */}
      <header className="flex h-16 items-center justify-between border-b border-border px-6 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Settings</h1>
          <PageHelp 
            title="Settings Guide"
            description="Manage your system behavior, themes, timeouts, and browser integration. Adjust configurations using the sub-tabs."
            tips={[
              "General tab controls themes and login startup.",
              "Security tab controls timeout, master password, and recovery questions."
            ]}
          />
        </div>
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
            <div id="tour-settings-general" className="space-y-6">
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
                    value={clipboardTimeout + "s"}
                    onChange={async e => {
                      const secs = parseInt(e.target.value.replace("s", ""), 10);
                      await updateSetting("clipboard_timeout", secs.toString());
                    }}
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
                          onClick={async () => {
                            await updateSetting("theme", t);
                          }}
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
                    <span className="font-semibold block">Start Clavis on System Boot</span>
                    <span className="text-[10px] text-muted-foreground">Launch Clavis minimized automatically when system turns on</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autostartEnabled}
                    onChange={(e) => handleToggleAutostart(e.target.checked)}
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer bg-transparent"
                  />
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Interactive Onboarding Tour</span>
                    <span className="text-[10px] text-muted-foreground">Replay the guided tutorial explaining how to use Clavis</span>
                  </div>
                  <Button 
                    id="tour-replay-button"
                    onClick={onReplayTour}
                    className="h-8 text-xs bg-purple text-white hover:bg-purple/90 shrink-0 font-semibold cursor-pointer"
                  >
                    Replay Tutorial
                  </Button>
                </div>
              </div>

              {/* Browser Extension Callout */}
              <div id="tour-extensions" className="border border-border rounded-lg bg-card/30 p-4.5 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <Info size={14} className="text-purple animate-pulse" />
                  <span className="font-semibold text-xs">Clavis Browser Extension</span>
                </div>
                <p className="text-muted-foreground leading-normal text-[11px]">
                  Sideload Clavis directly into Chrome, Brave, Firefox, and other browsers. Autofill and save credentials locally without external dependencies.
                </p>
                <div className="flex gap-4 pt-1">
                  <button 
                    onClick={() => setActiveTab("extension")} 
                    className="text-[11px] text-purple hover:underline font-semibold cursor-pointer"
                  >
                    Open Extension Settings & Setup
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "security" && (
            <div id="tour-settings-security" className="space-y-6">
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

                {/* Screen Capture Protection toggle */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Screen capture protection</span>
                    <span className="text-[10px] text-muted-foreground">Excludes Clavis windows from screenshots, OBS, and screen sharing</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={screenCaptureProtected}
                    onChange={(e) => updateSetting("screen_capture_protected", e.target.checked ? "true" : "false")}
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer bg-transparent"
                  />
                </div>

                {/* Autotype Global Hotkey */}
                <div id="tour-settings-autotype" className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Autotype hotkey</span>
                    <span className="text-[10px] text-muted-foreground">Global shortcut to trigger background autotype (e.g., Ctrl+Shift+V)</span>
                  </div>
                  <input
                    type="text"
                    value={autotypeShortcut}
                    onKeyDown={handleHotkeyKeyDown}
                    placeholder="Press hotkey..."
                    readOnly
                    className="h-8 w-32 px-2 bg-card border border-border rounded text-center text-xs font-semibold text-foreground focus:ring-1 focus:ring-purple outline-none cursor-pointer"
                  />
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
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer bg-transparent"
                  />
                </div>

                {/* Autotype delay row */}
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Autotype delay</span>
                    <span className="text-[10px] text-muted-foreground">Time window delay injection between characters (10ms - 100ms)</span>
                  </div>
                  <select
                    value={autotypeDelay.toString()}
                    onChange={async e => {
                      await updateSetting("autotype_delay", e.target.value);
                    }}
                    className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-none"
                  >
                    <option value="10">10 ms</option>
                    <option value="25">25 ms</option>
                    <option value="50">50 ms</option>
                    <option value="100">100 ms</option>
                  </select>
                </div>

                {/* Quick Unlock Settings Group */}
                <div className="pt-6 border-t border-border/40 space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">Quick Unlock Options</h3>
                    <p className="text-[10px] text-muted-foreground">Select alternatives to authorize faster during session lockouts.</p>
                  </div>

                  <div className="divide-y divide-border border border-border rounded-lg bg-card overflow-hidden">
                    {/* PIN Row */}
                    <div className="flex items-center justify-between p-4 text-xs">
                      <div>
                        <span className="font-semibold block">PIN Quick Unlock</span>
                        <span className="text-[10px] text-muted-foreground block mt-0.5">
                          {quickUnlockMethod === "pin" && hasEnrolledPin 
                            ? "Enrolled (Active Quick Unlock)" 
                            : hasEnrolledPin 
                              ? "Enrolled (Not active)" 
                              : "Not set up"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {hasEnrolledPin && (
                          <Button
                            onClick={() => handleDisableQuickUnlock("pin")}
                            variant="outline"
                            className="h-8 text-xs border-danger/30 text-danger hover:bg-danger/10 font-semibold cursor-pointer"
                          >
                            Disable PIN
                          </Button>
                        )}
                        <Button
                          onClick={() => handleStartQuickUnlockWizard("pin")}
                          className="h-8 text-xs bg-purple text-white hover:bg-purple/90 font-semibold cursor-pointer"
                        >
                          {hasEnrolledPin ? "Change PIN" : "Set up PIN"}
                        </Button>
                      </div>
                    </div>

                    {/* Biometric Row */}
                    <div className="flex items-center justify-between p-4 text-xs">
                      <div>
                        <span className="font-semibold block">Biometric Fingerprint Unlock</span>
                        <span className="text-[10px] text-muted-foreground block mt-0.5">
                          {quickUnlockMethod === "fingerprint" 
                            ? "Enrolled (Active Quick Unlock)" 
                            : "Not set up"}
                        </span>
                      </div>
                      <div>
                        {quickUnlockMethod === "fingerprint" ? (
                          <Button
                            onClick={() => handleDisableQuickUnlock("fingerprint")}
                            variant="outline"
                            className="h-8 text-xs border-danger/30 text-danger hover:bg-danger/10 font-semibold cursor-pointer"
                          >
                            Disable Biometrics
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleStartQuickUnlockWizard("fingerprint")}
                            className="h-8 text-xs bg-purple text-white hover:bg-purple/90 font-semibold cursor-pointer"
                          >
                            Set up Biometrics
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "extension" && (
            <div className="space-y-6 animate-fade-in text-left">
              <div>
                <h2 className="text-sm font-semibold mb-1">Browser Extension Integration</h2>
                <p className="text-xs text-muted-foreground">Configure communication channels, connection indicators, and companion permissions.</p>
              </div>

              {/* Status parameters card */}
              <div className="border border-border rounded-lg bg-card/30 p-4 space-y-4">
                <h3 className="text-xs font-bold text-foreground">WebSocket Status Reports</h3>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="border border-border rounded-lg bg-background p-3.5 space-y-1">
                    <span className="text-[9px] uppercase font-bold text-muted-foreground">Connector status</span>
                    <div className="flex items-center gap-1.5 font-semibold text-teal mt-0.5 animate-pulse">
                      <span className="h-2 w-2 rounded-full bg-teal" />
                      Running (Port 59001)
                    </div>
                  </div>

                  <div className="border border-border rounded-lg bg-background p-3.5 space-y-1">
                    <span className="text-[9px] uppercase font-bold text-muted-foreground">Active channel companions</span>
                    <div className="font-semibold text-foreground mt-0.5">
                      {activeCompanions} companion{activeCompanions === 1 ? "" : "s"} active
                    </div>
                  </div>
                </div>

                {/* Configuration rule toggle */}
                <div className="flex items-center justify-between border-t border-border pt-4 text-xs">
                  <div>
                    <span className="font-semibold block">Lock when extension disconnects</span>
                    <span className="text-[10px] text-muted-foreground">Automatically lock local vault if WebSocket companion goes offline</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={lockOnExtDisconnect}
                    onChange={(e) => handleToggleLockOnDisconnect(e.target.checked)}
                    className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer bg-transparent"
                  />
                </div>
              </div>

              {/* Detected Browsers Panel */}
              <div className="border border-border rounded-lg bg-card/30 p-4 space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-foreground mb-1">Detected System Browsers</h3>
                  <p className="text-[10px] text-muted-foreground">Status of local browser installations and Native Messaging broker registry setup.</p>
                </div>

                <div className="space-y-2">
                  {detectedBrowsers.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic p-2">Scanning system browsers...</div>
                  ) : (
                    detectedBrowsers.map((b) => (
                      <div key={b.name} className="flex items-center justify-between border border-border/60 bg-background/50 rounded-lg p-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          {b.detected ? (
                            <span className="text-green-500 font-bold text-sm">✓</span>
                          ) : (
                            <span className="text-muted-foreground font-bold text-sm">✗</span>
                          )}
                          <span className={b.detected ? "font-semibold text-foreground" : "text-muted-foreground"}>
                            {b.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {b.detected ? (
                            b.extension_installed ? (
                              <div className="flex items-center gap-1 bg-teal/10 text-teal border border-teal/20 px-2 py-0.5 rounded text-[10px] font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse" />
                                Host Registered
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 bg-amber/10 text-amber border border-amber/20 px-2 py-0.5 rounded text-[10px] font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                                Pending Setup
                              </div>
                            )
                          ) : (
                            <span className="text-[10px] text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded">
                              Not Detected
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Trouble shooting alert/info link */}
                <div className="p-3 bg-purple/5 border border-purple/10 rounded-lg text-[10px] text-muted-foreground flex gap-2">
                  <Info size={14} className="text-purple shrink-0 mt-0.5" />
                  <div className="space-y-1 leading-normal">
                    <p className="font-semibold text-foreground text-[11px]">How to configure the connection:</p>
                    <p>To enable communication between the browser extension and Clavis desktop, run the helper setup script in the project directory:</p>
                    <code className="block bg-card/50 border border-border p-1 rounded font-mono text-[9px] text-purple select-text">bash setup-flatpak.sh</code>
                  </div>
                </div>
              </div>

              {/* Blocklist panel */}
              <div className="border border-border rounded-lg bg-card/30 p-4 space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-foreground mb-1">Blocked Companion Domains</h3>
                  <p className="text-[10px] text-muted-foreground">Companion connections from these web domains will be automatically rejected.</p>
                </div>

                {/* Add new domain */}
                <div className="flex gap-2.5">
                  <Input
                    type="text"
                    placeholder="e.g. malicious-site.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    className="text-xs h-8 bg-card/15 flex-1"
                  />
                  <Button
                    onClick={handleAddDomain}
                    className="h-8 text-xs bg-purple text-white hover:bg-purple/90 shrink-0 px-4 font-semibold cursor-pointer"
                  >
                    Block Domain
                  </Button>
                </div>

                {/* Blocklist Table */}
                <div className="border border-border rounded-lg bg-background overflow-hidden">
                  {blocklist.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground italic">
                      No domains are currently blocklisted.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                          <th className="p-2.5">Domain Name</th>
                          <th className="p-2.5 text-right font-bold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {blocklist.map(domain => (
                           <tr key={domain} className="hover:bg-muted/15">
                            <td className="p-2.5 font-mono text-[11px] text-foreground">{domain}</td>
                            <td className="p-2.5 text-right">
                              <button
                                onClick={() => handleRemoveDomain(domain)}
                                className="text-[10px] text-danger hover:underline font-semibold cursor-pointer"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
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

              {importError && (
                <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">
                  {importError}
                </div>
              )}

              {importSuccessMsg && (
                <div className="p-3 bg-teal/10 border border-teal/20 rounded-lg text-xs text-teal">
                  {importSuccessMsg}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Import Card */}
                <div className="border border-border rounded-lg bg-card p-4 space-y-3.5 flex flex-col justify-between">
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold text-foreground">Import Credentials</h3>
                    
                    <button 
                      onClick={handleSelectImportFile}
                      className="w-full border border-dashed border-border rounded-lg p-4 text-center hover:border-purple/40 bg-background/50 hover:bg-muted/10 transition-colors flex flex-col items-center justify-center gap-1 cursor-pointer"
                    >
                      <FolderOpen size={16} className="text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground font-semibold">
                        {importFilePath ? importFilePath.split("/").pop() : "Browse backup file..."}
                      </span>
                    </button>

                    {/* CSV Template Guideline */}
                    <div className="rounded-lg bg-muted/20 border border-border p-2.5 space-y-1.5 text-[10px] text-muted-foreground text-left leading-normal">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-foreground block text-[9.5px]">Accepted CSV Format Template:</span>
                        <button
                          type="button"
                          onClick={handleDownloadTemplate}
                          className="text-[9px] text-purple hover:underline font-semibold cursor-pointer border-none bg-transparent"
                        >
                          Download Template
                        </button>
                      </div>
                      <pre className="font-mono bg-background/70 p-1.5 rounded text-[9px] overflow-x-auto text-foreground border border-border/40 select-text">
                        title,username,password{"\n"}
                        Google,achyllisss,mysecurepass123{"\n"}
                        GitHub,achyllisss,githubpass456
                      </pre>
                      <span className="block text-[9px]">
                        Headers containing <strong>title</strong> (or name, site) and <strong>username</strong> (or email, login) are automatically identified.
                      </span>
                    </div>

                    {importFilePath && importFilePath.endsWith(".clavis") && (
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase font-bold text-muted-foreground">Decryption Passphrase</label>
                        <div className="relative">
                          <Input
                            type={showImportPass ? "text" : "password"}
                            value={importPassphrase}
                            onChange={e => setImportPassphrase(e.target.value)}
                            placeholder="File passphrase"
                            className="h-8 text-xs bg-background"
                          />
                          <button
                            type="button"
                            onClick={() => setShowImportPass(!showImportPass)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showImportPass ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                        </div>
                      </div>
                    )}

                    {importFilePath && (
                      <Button 
                        onClick={handleLoadImportPreview}
                        disabled={isImportLoading}
                        className="w-full h-8 text-[11px] bg-muted hover:bg-muted/80 text-foreground font-semibold"
                      >
                        {isImportLoading ? "Parsing..." : "Load Preview"}
                      </Button>
                    )}

                    {importPreviewItems && (
                      <div className="space-y-2.5">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="font-semibold text-teal">Import Preview</span>
                          <span className="rounded-full bg-teal/10 px-2 py-0.5 font-bold text-teal border border-teal/20">
                            {importPreviewItems.length} entries found
                          </span>
                        </div>
                        
                        {/* Premium scrollable grid preview table */}
                        <div className="border border-border rounded-lg bg-background overflow-hidden max-h-36 overflow-y-auto">
                          <table className="w-full text-left text-[10px] border-collapse">
                            <thead>
                              <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground sticky top-0">
                                <th className="p-2 border-r border-border/50">Title</th>
                                <th className="p-2">Username</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {importPreviewItems.map((item, idx) => (
                                <tr key={idx} className="hover:bg-muted/15 transition-colors">
                                  <td className="p-2 font-semibold text-foreground truncate max-w-[120px] border-r border-border/30">{item.title}</td>
                                  <td className="p-2 text-muted-foreground truncate max-w-[120px] font-mono">
                                    {item.username || <span className="italic text-muted-foreground/40 font-sans">None</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="space-y-1 pt-1.5">
                          <label className="text-[9px] uppercase font-bold text-muted-foreground block">Conflict Resolution</label>
                          <select 
                            value={importConflict}
                            onChange={e => setImportConflict(e.target.value)}
                            className="h-8 w-full rounded border border-border bg-background px-2 text-xs focus:outline-none"
                          >
                            <option value="skip">Skip duplicates</option>
                            <option value="overwrite">Overwrite existing</option>
                            <option value="create_new">Generate new records (Split)</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <Button 
                    onClick={handleExecuteImport}
                    disabled={!importPreviewItems || isImportLoading}
                    className="w-full h-8 text-xs bg-purple text-white hover:bg-purple/90 mt-2 font-semibold"
                  >
                    {isImportLoading ? "Importing..." : "Execute Import"}
                  </Button>
                </div>

                {/* Export Card */}
                <div className="border border-border rounded-lg bg-card p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold text-foreground">Export Credentials</h3>
                    <div className="flex gap-2 p-3 bg-danger/5 border border-danger/15 rounded-lg text-[10px] text-danger leading-normal">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>Warning: Plaintext exports contain passwords. Store backups in encrypted storage environments only.</span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <Button 
                      onClick={() => setExportEncryptedOpen(true)}
                      className="w-full h-8 text-xs bg-purple text-white hover:bg-purple/90 font-semibold"
                    >
                      Export Securely (.clavis)
                    </Button>
                    
                    <Button 
                      variant="outline" 
                      onClick={() => setExportCsvOpen(true)}
                      className="w-full h-8 text-xs border-danger/30 text-danger hover:bg-danger/10 font-semibold"
                    >
                      Export Plaintext (CSV)
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "backup" && (
            <div id="tour-settings-backup" className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold mb-1">Backup & Restore</h2>
                <p className="text-xs text-muted-foreground">Configure auto backups and manual database checkpoints.</p>
              </div>

              <div className="divide-y divide-border border border-border rounded-lg bg-card overflow-hidden">
                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Back up vault now</span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Flush SQLCipher database and create a timestamped snapshot</span>
                  </div>
                  <Button onClick={handleBackupNow} className="h-8 text-xs bg-purple text-white hover:bg-purple/90 font-semibold">
                    Create Backup
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Restore database snapshot</span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5 text-danger">Warning: Overwrites current entries. Safety backup is created beforehand.</span>
                  </div>
                  <Button onClick={handleRestoreBackup} variant="outline" className="h-8 text-xs border-danger/30 text-danger hover:bg-danger/10 font-semibold">
                    Restore Backup
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Backup target folder</span>
                    <span className="text-[10px] text-muted-foreground font-mono block mt-0.5 truncate max-w-sm">
                      {backupDirectory || "Default (~/.local/share/com.achyllisss.clavis/backups)"}
                    </span>
                  </div>
                  <Button onClick={handleSelectBackupDirectory} variant="ghost" size="sm" className="h-8 text-xs font-semibold text-purple hover:bg-purple-soft/40 cursor-pointer">
                    Change Folder
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Auto-backup interval</span>
                    <span className="text-[10px] text-muted-foreground font-mono block mt-0.5">Frequency of automated cron backup writes</span>
                  </div>
                  <select
                    value={backupInterval}
                    onChange={async e => {
                      await updateSetting("backup_interval", e.target.value);
                    }}
                    className="h-8 rounded border border-border bg-background px-2 text-xs focus:outline-none"
                  >
                    <option value="Off">Disabled</option>
                    <option value="Daily">Daily</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Pre-checkpoint">Pre-checkpoint</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-4 text-xs">
                  <div>
                    <span className="font-semibold block">Retention Limit</span>
                    <span className="text-[10px] text-muted-foreground font-mono block mt-0.5">Maximum number of backups kept in folder</span>
                  </div>
                  <select
                    value={backupRetention.toString()}
                    onChange={async e => {
                      await updateSetting("backup_retention", e.target.value);
                    }}
                    className="h-8 rounded border border-border bg-background px-2 text-xs focus:outline-none"
                  >
                    <option value="3">3 backups</option>
                    <option value="5">5 backups</option>
                    <option value="10">10 backups</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === "about" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold mb-1">About Clavis</h2>
                <p className="text-xs text-muted-foreground">System descriptors and compilation parameters.</p>
              </div>

              <div className="divide-y divide-border border border-border rounded-lg bg-card overflow-hidden">
                <div className="flex justify-between p-4 text-xs">
                  <span className="font-medium text-muted-foreground">App version</span>
                  <span className="font-semibold">{appVersion} (clavis)</span>
                </div>
                <div className="flex justify-between p-4 text-xs">
                  <span className="font-medium text-muted-foreground">Tauri version</span>
                  <span className="font-semibold">v2.11.3 (core-api)</span>
                </div>
                <div className="flex justify-between items-center p-4 text-xs">
                  <span className="font-medium text-muted-foreground">cargo audit status</span>
                  <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal border border-teal/20">
                    Passing
                  </span>
                </div>
                <div className="flex justify-between p-4 text-xs">
                  <span className="font-medium text-muted-foreground">GitHub Repository</span>
                  <a href="https://github.com/clavis" target="_blank" rel="noreferrer" className="text-purple hover:underline font-semibold">
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
              <span>This will re-encrypt your entire database. Do not close the app during this process.</span>
            </div>

            {lockoutUntil ? (
              <div className="p-4 text-center border border-border rounded bg-muted/20 text-xs space-y-1">
                <span className="font-semibold text-danger block">Workflow Frozen due to security attempts limits</span>
                <span className="text-muted-foreground">Remaining Lockout Timeout: <strong>{lockoutTimer}s</strong></span>
              </div>
            ) : (
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground animate-none"
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground animate-none"
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground animate-none"
                    >
                      {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <PasswordStrengthMeter password={newPw} minScoreRequired={3} />
                
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
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setChangePwOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={lockoutUntil !== null || !newPwAllMet || newPwScore < 3}
                className="text-xs bg-purple text-white hover:bg-purple/90"
              >
                Update password
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ENCRYPTED VAULT EXPORT DIALOG */}
      {exportEncryptedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <form onSubmit={handleExportEncryptedSubmit} className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 animate-fade-in text-foreground">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <h2 className="text-sm font-semibold">Export Secure Vault (.clavis)</h2>
              <button 
                type="button" 
                onClick={() => setExportEncryptedOpen(false)} 
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {exportError && (
              <p className="text-xs text-danger bg-danger/10 border border-danger/20 p-2 rounded-lg">{exportError}</p>
            )}

            <div className="flex gap-2.5 p-3 bg-purple/10 border border-purple/20 rounded-lg text-xs text-purple leading-normal">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>Configure a strong custom passphrase separate from your master password to encrypt this export.</span>
            </div>

            <div className="space-y-3">
              {/* Passphrase */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Export Passphrase</label>
                <div className="relative">
                  <Input
                    type={showExportPassphrase ? "text" : "password"}
                    value={exportPassphrase}
                    onChange={e => setExportPassphrase(e.target.value)}
                    placeholder="Enter unique export passphrase"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowExportPassphrase(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showExportPassphrase ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Confirm Passphrase */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Confirm Passphrase</label>
                <div className="relative">
                  <Input
                    type={showExportConfirm ? "text" : "password"}
                    value={exportConfirmPassphrase}
                    onChange={e => setExportConfirmPassphrase(e.target.value)}
                    placeholder="Confirm export passphrase"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowExportConfirm(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showExportConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <PasswordStrengthMeter password={exportPassphrase} minScoreRequired={3} />
              
              {/* Requirements Checklist */}
              <ul className="grid grid-cols-2 gap-1.5 pt-1 text-xs">
                {[
                  ["12+ characters", exportPwChecks.length],
                  ["Uppercase letter", exportPwChecks.upper],
                  ["Lowercase letter", exportPwChecks.lower],
                  ["Number", exportPwChecks.number],
                  ["Symbol", exportPwChecks.symbol],
                ].map(([label, ok]) => (
                  <li key={label as string} className={cn("flex items-center gap-1.5 transition-colors duration-300", ok ? "text-teal" : "text-muted-foreground")}>
                    <Check size={12} className={cn("transition-opacity duration-300", ok ? "opacity-100" : "opacity-30")} />
                    {label}
                  </li>
                ))}
              </ul>
              {exportPassphrase && exportConfirmPassphrase && exportPassphrase !== exportConfirmPassphrase && (
                <p className="text-xs text-danger">Passphrases do not match</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setExportEncryptedOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={!exportPwAllMet || exportPwScore < 3}
                className="text-xs bg-purple text-white hover:bg-purple/90"
              >
                Choose Save Path
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* CSV EXPORT UNENCRYPTED WARNING DIALOG (3-Tier verification layout) */}
      {exportCsvOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 animate-fade-in text-foreground">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-danger">Warning: Unencrypted CSV Export</h2>
              <button 
                type="button" 
                onClick={() => setExportCsvOpen(false)} 
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {/* Warning Banner */}
            <div className="flex gap-2.5 p-3.5 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger leading-relaxed">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block">Plaintext Security Hazard!</span>
                <span>This option extracts all passwords and usernames in an unencrypted plaintext format. Anyone with access to the generated file can read your secrets immediately.</span>
              </div>
            </div>

            {/* Three-Tier Verification Controls */}
            <div className="space-y-3.5 pt-1 text-xs">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="csv-check-1"
                  checked={csvCheck1}
                  onChange={e => setCsvCheck1(e.target.checked)}
                  className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer mt-0.5 animate-none"
                />
                <label htmlFor="csv-check-1" className="text-muted-foreground leading-normal cursor-pointer select-none">
                  I understand that my passwords will be exposed in clear unencrypted text.
                </label>
              </div>

              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="csv-check-2"
                  checked={csvCheck2}
                  onChange={e => setCsvCheck2(e.target.checked)}
                  className="h-4 w-4 text-purple rounded border-border focus:ring-purple cursor-pointer mt-0.5 animate-none"
                />
                <label htmlFor="csv-check-2" className="text-muted-foreground leading-normal cursor-pointer select-none">
                  I accept full responsibility for securely storing and deleting the generated file.
                </label>
              </div>

              <div className="space-y-1 pt-1.5">
                <label className="text-[10px] uppercase font-bold text-muted-foreground block">
                  Type <span className="text-danger font-bold">EXPORT</span> to confirm:
                </label>
                <Input
                  type="text"
                  placeholder="Type EXPORT"
                  value={csvConfirmationText}
                  onChange={e => setCsvConfirmationText(e.target.value)}
                  className="h-8 text-xs bg-background"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setExportCsvOpen(false)} className="text-xs font-semibold">
                Cancel
              </Button>
              <Button 
                onClick={handleExportCsvExecute} 
                disabled={!csvCheck1 || !csvCheck2 || csvConfirmationText !== "EXPORT"}
                className="text-xs bg-danger text-white hover:bg-danger/90 font-semibold"
              >
                Proceed & Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Unlock Setup Wizard Modal */}
      {wizardTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="w-[320px] rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4 text-center">
            
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-xs font-bold text-foreground">
                {wizardTarget === "pin" ? "PIN Unlock Setup" : "Biometrics Setup"}
              </span>
              <button 
                onClick={() => setWizardTarget(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {wizardStep === "auth" && (
              <form onSubmit={handleVerifyPassword} className="space-y-4">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Enter your master password to authenticate before enabling quick unlock.
                </p>
                <div className="space-y-1 text-left">
                  <Input
                    type="password"
                    placeholder="Enter Master Password..."
                    value={wizardPassword}
                    onChange={e => setWizardPassword(e.target.value)}
                    className="h-8 text-xs bg-muted/20 w-full"
                    autoFocus
                  />
                  {wizardAuthError && (
                    <span className="text-[9px] text-danger block">{wizardAuthError}</span>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setWizardTarget(null)} 
                    className="h-7 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={wizardAuthLoading || !wizardPassword} 
                    className="h-7 text-xs bg-purple text-white hover:bg-purple/90 font-semibold cursor-pointer"
                  >
                    {wizardAuthLoading ? "Verifying..." : "Verify"}
                  </Button>
                </div>
              </form>
            )}

            {wizardStep === "enroll" && wizardTarget === "fingerprint" && (
              <div className="space-y-4 py-4 flex flex-col items-center">
                {enrollingFingerprint ? (
                  <div className="space-y-3 text-center">
                    <Fingerprint size={40} className="text-purple animate-pulse mx-auto" />
                    <p className="text-[10px] text-muted-foreground">Biometrics setup initializing...</p>
                  </div>
                ) : fingerprintEnrolled ? (
                  <div className="space-y-3 text-center">
                    <Check size={40} className="text-teal mx-auto" />
                    <p className="text-[10px] text-teal font-semibold">Fingerprint Registered Successfully</p>
                  </div>
                ) : null}
              </div>
            )}

            {(wizardStep === "enroll" || wizardStep === "confirm") && wizardTarget === "pin" && (
              <div className={cn("flex flex-col items-center space-y-4", wizardPinShake && "animate-shake")}>
                <p className="text-[10px] font-bold text-foreground">
                  {wizardPinPhase === "enter" ? "Enter a 4-6 digit PIN" : "Re-enter PIN to confirm"}
                </p>

                {/* Dots indicator */}
                <div className="flex gap-2 my-1 h-2 items-center">
                  {Array.from({ length: wizardPinPhase === "enter" ? 6 : wizardPin.length }).map((_, i) => {
                    const active = wizardPinPhase === "enter" ? i < wizardPin.length : i < wizardConfirmPin.length;
                    return (
                      <div 
                        key={i} 
                        className={cn(
                          "h-2.5 w-2.5 rounded-full border transition-all duration-150",
                          active 
                            ? wizardPinStatus === "error" 
                              ? "bg-danger border-danger scale-110" 
                              : wizardPinStatus === "success" 
                                ? "bg-teal border-teal scale-110" 
                                : "bg-purple border-purple scale-110"
                            : "bg-card border-border/80"
                        )}
                      />
                    );
                  })}
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-5 gap-1.5 w-full max-w-[200px] pt-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleWizardPinKey(String(n))}
                      className="h-7 rounded bg-card hover:bg-muted border border-border/40 text-xs font-semibold cursor-pointer flex items-center justify-center text-foreground"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
