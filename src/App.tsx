import { useEffect, useState } from "react";
import { useVaultStore } from "./hooks/useVaultStore";
import Setup from "./pages/Setup";
import Unlock from "./pages/Unlock";
import Dashboard from "./pages/Dashboard";
import Security from "./pages/Security";
import Authenticator from "./pages/Authenticator";
import ActivityLog from "./pages/ActivityLog";
import Settings from "./pages/Settings";
import { 
  LayoutList, ShieldAlert, Clock, ScrollText, Settings as SettingsIcon, 
  Lock, ShieldCheck, Sun, Moon 
} from "lucide-react";
import { cn } from "./lib/utils";
import "./index.css";
import * as tauri from "./lib/tauri";
(window as any).tauri = tauri;

type PageView = "dashboard" | "security" | "authenticator" | "activity" | "settings";

function App() {
  const {
    isLocked,
    checkInitialization,
    checkLockStatus,
    lock,
    clipboardCountdown,
    clearClipboardCountdown,
  } = useVaultStore();

  const [checking, setChecking] = useState(true);
  const [setupFinished, setSetupFinished] = useState(false);
  const [startedSetup, setStartedSetup] = useState(false);

  // Router view state
  const [currentView, setCurrentView] = useState<PageView>("dashboard");
  const [isDark, setIsDark] = useState(true);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);

  // Setup auto-lock idle timeout and focus lost event listeners
        useEffect(() => {
          if (isLocked) return;
  
          let idleTimer: number;
  
          const resetIdleTimer = () => {
            if (idleTimer) window.clearTimeout(idleTimer);
            // Fetch fresh settings state
            const { idleTimeout } = useVaultStore.getState();
  
            idleTimer = window.setTimeout(() => {
              console.log("Idle timeout reached. Locking vault...");
              lock();
            }, idleTimeout * 1000);
          };
  
          // Attach event listeners for user activity
          const events = ["mousemove", "keydown", "mousedown", "touchstart"];
          events.forEach((evt) => window.addEventListener(evt, resetIdleTimer));
  
          // Initialize timer
          resetIdleTimer();
  
          // Tauri Focus Loss event
          let active = true;
          let unlistenFocus: (() => void) | undefined;
  
          const initFocusListener = async () => {
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              const appWindow = getCurrentWindow();
              const unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
                const { lockOnFocusLost } = useVaultStore.getState();
                if (!focused && lockOnFocusLost) {
                  console.log("Focus lost. Locking vault...");
                  lock();
                }
              });
              if (!active) {
                unlisten();
              } else {
                unlistenFocus = unlisten;
              }
            } catch (err) {
              console.error("Failed to set up focus listener:", err);
            }
          };
  
          initFocusListener();
  
          // Clean up listeners on lock or unmount
          return () => {
            active = false;
            if (idleTimer) window.clearTimeout(idleTimer);
            events.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
            if (unlistenFocus) {
              unlistenFocus();
            }
          };
        }, [isLocked, lock]);
  
  useEffect(() => {
    const initStore = async () => {
      await checkInitialization();
      await checkLockStatus();
      
      const initialized = useVaultStore.getState().isInitialized;
      setStartedSetup(!initialized);
      
      setChecking(false);
    };
    initStore();
  }, [checkInitialization, checkLockStatus]);

  // Handle Theme Toggle
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple border-t-transparent" />
          <p className="text-sm text-muted-foreground font-medium">Checking vault status...</p>
        </div>
      </div>
    );
  }

  // If not initialized yet and setup is not marked complete, show the setup screen
  if (startedSetup && !setupFinished) {
    return <Setup onComplete={() => setSetupFinished(true)} />;
  }

  // If initialized but locked, show the unlock screen
  if (isLocked) {
    return <Unlock />;
  }

  // Handle actual lock action confirm
  const handleLockConfirm = async () => {
    setLockConfirmOpen(false);
    await lock();
    setCurrentView("dashboard"); // reset view
  };

  const navItems = [
    { id: "dashboard" as PageView, icon: LayoutList, label: "Dashboard" },
    { id: "security" as PageView, icon: ShieldAlert, label: "Security Reports" },
    { id: "authenticator" as PageView, icon: Clock, label: "TOTP Authenticator" },
    { id: "activity" as PageView, icon: ScrollText, label: "Activity Log" },
  ];

  // Render the current view page
  const renderViewContent = () => {
    switch (currentView) {
      case "dashboard":
        return <Dashboard />;
      case "security":
        return <Security />;
      case "authenticator":
        return <Authenticator />;
      case "activity":
        return <ActivityLog />;
      case "settings":
        return <Settings />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground select-none overflow-hidden font-sans">
      
      {/* NARROW FIXED SIDEBAR (56px wide) */}
      <aside className="w-14 h-screen shrink-0 flex flex-col justify-between border-r border-border bg-sidebar py-3 items-center z-20">
        
        {/* Top Section: Navigation */}
        <div className="flex flex-col items-center gap-1.5 w-full">
          {/* Logo */}
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-purple text-white shadow-md shadow-purple/20">
            <ShieldCheck size={20} />
          </div>

          {navItems.map((item) => {
            const active = currentView === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                title={item.label}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200",
                  active 
                    ? "bg-purple-soft text-purple" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon size={18} />
              </button>
            );
          })}
        </div>

        {/* Bottom Section: Theme, Settings, and Lock */}
        <div className="flex flex-col items-center gap-1.5 w-full">
          {/* Night / Light Mode Toggle */}
          <button
            onClick={() => setIsDark(d => !d)}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {/* Settings button */}
          <button
            onClick={() => setCurrentView("settings")}
            title="Settings"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200",
              currentView === "settings" 
                ? "bg-purple-soft text-purple" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <SettingsIcon size={17} />
          </button>

          {/* Red Lock Vault Button */}
          <button
            onClick={() => setLockConfirmOpen(true)}
            title="Lock Vault"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
          >
            <Lock size={17} />
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 min-w-0 h-screen relative">
        {renderViewContent()}

        {/* Global Clipboard Auto-Clear Indicator */}
        {clipboardCountdown !== null && (
          <div className="absolute bottom-4 right-4 z-40 bg-zinc-900 border border-purple/30 text-white rounded-lg shadow-lg py-2.5 px-4 flex items-center gap-3 animate-fade-in text-xs font-medium">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-purple/20 text-purple">
              <ScrollText size={12} className="animate-pulse" />
            </div>
            <span>Clipboard clears in <strong className="text-purple font-bold">{clipboardCountdown}s</strong></span>
            <button
              onClick={async () => {
                try {
                  await tauri.copyToClipboard("");
                  clearClipboardCountdown();
                } catch (err) {
                  console.error("Failed to clear clipboard", err);
                }
              }}
              className="text-[10px] text-muted-foreground hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors ml-1 cursor-pointer"
            >
              Clear Now
            </button>
          </div>
        )}
      </main>

      {/* LOCK VAULT CONFIRMATION DIALOG (Modal 5) */}
      {lockConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-5 shadow-xl space-y-4 animate-scale-up text-foreground">
            <div className="flex gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-purple/10 flex items-center justify-center text-purple">
                <Lock size={18} />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Lock your vault?</h2>
                <p className="text-xs text-muted-foreground leading-normal">
                  Your session will end and the vault key will be cleared from memory.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-border/40">
              <button
                onClick={() => setLockConfirmOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-border bg-transparent text-xs font-semibold hover:bg-muted text-muted-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLockConfirm}
                className="px-3.5 py-1.5 rounded-lg bg-purple text-white text-xs font-semibold hover:bg-purple/90 transition-colors"
              >
                Lock now
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
