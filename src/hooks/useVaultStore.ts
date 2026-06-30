import { create } from "zustand";
import {
  Vault,
  EntrySummary,
  isVaultInitialized,
  isVaultLocked,
  createVault,
  unlock,
  lock as tauriLock,
  createVaultPartition,
  listVaults,
  deleteVault,
  createEntry,
  listEntries,
  updateEntry,
  deleteEntry,
  getSetting,
  setSetting,
  createVaultWithSecurity,
  resetMasterPassword,
  SecurityQuestionAnswer,
  setScreenCaptureProtection,
  updateAutotypeShortcut,
  clearAllShortcuts
} from "../lib/tauri";
import { logEvent } from "../lib/activity";

let globalClipboardInterval: any = null;

    export interface ToastMessage {
      id: string;
      title: string;
      message: string;
      type: "success" | "info" | "warning" | "error";
    }

    interface VaultState {
      isInitialized: boolean;
      isLocked: boolean;
      vaults: Vault[];
      activeVault: Vault | null;
      entries: EntrySummary[];
      loading: boolean;
      error: string | null;
      idleTimeout: number; // Stored idle time (in seconds)
      lockOnFocusLost: boolean; // Focus-loss lock flag
      screenCaptureProtected: boolean; // Screen capture protection flag
      autotypeShortcut: string; // Autotype global hotkey (e.g. "Ctrl+Shift+V")
      theme: string;
      autotypeDelay: number;
      clipboardTimeout: number;
      backupInterval: string;
      backupDirectory: string;
      backupRetention: number;
      clipboardCountdown: number | null;
      startClipboardCountdown: () => void;
      clearClipboardCountdown: () => void;

      toasts: ToastMessage[];
      showToast: (title: string, message: string, type: "success" | "info" | "warning" | "error") => void;
      removeToast: (id: string) => void;

      checkInitialization: () => Promise<void>;
      checkLockStatus: () => Promise<void>;
      unlock: (password: string) => Promise<void>;
      initializeWithSecurity: (
        password: string,
        hint: string | null,
        questionsAnswers: SecurityQuestionAnswer[]
      ) => Promise<void>;
      recover: (
        answer1: string,
        answer2: string,
        newPassword: string
      ) => Promise<void>;
      lock: () => Promise<void>;
      fetchVaults: () => Promise<void>;
      selectVault: (vault: Vault | null) => Promise<void>;
      createVault: (name: string) => Promise<void>;
      deleteVault: (id: string) => Promise<void>;
      fetchEntries: () => Promise<void>;
      createEntry: (
        title: string,
        username: string | null,
        passwordPlaintext: string,
        totpSecretPlaintext: string | null
      ) => Promise<void>;
      updateEntry: (
        id: string,
        title: string,
        username: string | null,
        passwordPlaintext: string,
        totpSecretPlaintext: string | null
      ) => Promise<void>;
      deleteEntry: (id: string) => Promise<void>;
      clearError: () => void;
      fetchSettings: () => Promise<void>;
      updateSetting: (key: string, value: string) => Promise<void>;
      currentView: "dashboard" | "security" | "authenticator" | "activity" | "settings" | "help";
      selectedEntryId: string | null;
      activeSettingsTab: string;
      setCurrentView: (view: "dashboard" | "security" | "authenticator" | "activity" | "settings" | "help") => void;
      setSelectedEntryId: (id: string | null) => void;
      setActiveSettingsTab: (tab: string) => void;
    }

    export const useVaultStore = create<VaultState>((set, get) => ({
      isInitialized: false,
      isLocked: true,
      vaults: [],
      activeVault: null,
      entries: [],
      loading: false,
      error: null,
      toasts: [],
      showToast: (title, message, type) => {
        const id = Math.random().toString(36).substring(2, 9);
        const newToast = { id, title, message, type };
        set(state => ({ toasts: [...state.toasts, newToast].slice(-3) }));

        // Trigger native desktop notification via Tauri command
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("show_native_notification", { title, body: message }).catch(() => {});
        });

        // Auto-remove after 4 seconds
        setTimeout(() => {
          get().removeToast(id);
        }, 4000);
      },
      removeToast: (id) => {
        set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
      },
      idleTimeout: 300, // Default 5 minutes
      lockOnFocusLost: false, // Default off
      screenCaptureProtected: false, // Default off
      autotypeShortcut: "Ctrl+Shift+V",
      theme: "System",
      autotypeDelay: 50,
      clipboardTimeout: 30,
      backupInterval: "Weekly",
      backupDirectory: "",
      backupRetention: 5,
      clipboardCountdown: null,
      currentView: "dashboard",
      selectedEntryId: null,
      activeSettingsTab: "general",
      setCurrentView: (view) => set({ currentView: view }),
      setSelectedEntryId: (id) => set({ selectedEntryId: id }),
      setActiveSettingsTab: (tab) => set({ activeSettingsTab: tab }),

      checkInitialization: async () => {
        try {
          const initialized = await isVaultInitialized();
          set({ isInitialized: initialized });
        } catch (err: any) {
          set({ error: err.toString() });
        }
      },

      checkLockStatus: async () => {
        try {
          const locked = await isVaultLocked();
          set({ isLocked: locked });
          if (!locked) {
            await get().fetchVaults();
            await get().fetchSettings();
          }
        } catch (err: any) {
          set({ error: err.toString() });
        }
      },

      unlock: async (password: string) => {
        set({ loading: true, error: null });
        try {
          if (get().isInitialized) {
            await unlock(password);
          } else {
            await createVault(password);
          }
          set({ isLocked: false, isInitialized: true });
          await get().fetchVaults();
          await get().fetchSettings(); // Fetch settings on unlock
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      initializeWithSecurity: async (password: string, hint: string | null, questionsAnswers: SecurityQuestionAnswer[]) => {
        set({ loading: true, error: null });
        try {
          await createVaultWithSecurity(password, hint, questionsAnswers);
          set({ isLocked: false, isInitialized: true });
          await get().fetchVaults();
          await get().fetchSettings();
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      recover: async (answer1: string, answer2: string, newPassword: string) => {
        set({ loading: true, error: null });
        try {
          await resetMasterPassword([answer1, answer2], newPassword);
          set({ isLocked: false, isInitialized: true });
          await get().fetchVaults();
          await get().fetchSettings();
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      lock: async () => {
        set({ loading: true });
        try {
          try {
            await clearAllShortcuts();
          } catch (e) {
            console.error("Failed to clear shortcuts on lock:", e);
          }
          await tauriLock();
          set({
            isLocked: true,
            vaults: [],
            activeVault: null,
            entries: [],
          });
        } catch (err: any) {
          set({ error: err.toString() });
        } finally {
          set({ loading: false });
        }
      },

      fetchVaults: async () => {
        try {
          const vaultsList = await listVaults();
          set({ vaults: vaultsList });
          const active = get().activeVault;
          if (active) {
            const stillExists = vaultsList.some((v) => v.id === active.id);
            if (!stillExists) {
              set({ activeVault: null, entries: [] });
            }
          } else if (vaultsList.length > 0) {
            await get().selectVault(vaultsList[0]);
          }
        } catch (err: any) {
          set({ error: err.toString() });
        }
      },

      selectVault: async (vault: Vault | null) => {
        set({ activeVault: vault, entries: [] });
        if (vault) {
          await get().fetchEntries();
        }
      },

      createVault: async (name: string) => {
        set({ loading: true, error: null });
        try {
          const newVault = await createVaultPartition(name);
          await get().fetchVaults();
          await get().selectVault(newVault);
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      deleteVault: async (id: string) => {
        set({ loading: true, error: null });
        try {
          await deleteVault(id);
          const active = get().activeVault;
          if (active && active.id === id) {
            set({ activeVault: null, entries: [] });
          }
          await get().fetchVaults();
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      fetchEntries: async () => {
        const active = get().activeVault;
        if (!active) return;
        try {
          const entriesList = await listEntries(active.id);
          set({ entries: entriesList });
        } catch (err: any) {
          set({ error: err.toString() });
        }
      },

      createEntry: async (
        title: string,
        username: string | null,
        passwordPlaintext: string,
        totpSecretPlaintext: string | null
      ) => {
        const active = get().activeVault;
        if (!active) throw new Error("No active vault selected");
        set({ loading: true, error: null });
        try {
          await createEntry(active.id, title, username, passwordPlaintext, totpSecretPlaintext);
          await get().fetchEntries();
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      updateEntry: async (
        id: string,
        title: string,
        username: string | null,
        passwordPlaintext: string,
        totpSecretPlaintext: string | null
      ) => {
        set({ loading: true, error: null });
        try {
          await updateEntry(id, title, username, passwordPlaintext, totpSecretPlaintext);
          await get().fetchEntries();
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      deleteEntry: async (id: string) => {
        set({ loading: true, error: null });
        try {
          await deleteEntry(id);
          await get().fetchEntries();
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      clearError: () => set({ error: null }),

      fetchSettings: async () => {
        try {
          const timeoutStr = await getSetting("idle_timeout");
          const focusLostStr = await getSetting("lock_on_focus_lost");
          const captureProtectedStr = await getSetting("screen_capture_protected");
          const shortcutStr = await getSetting("autotype_shortcut") || "Ctrl+Shift+V";
          const themeStr = await getSetting("theme") || "System";
          const autotypeDelayStr = await getSetting("autotype_delay") || "50";
          const clipboardTimeoutStr = await getSetting("clipboard_timeout") || "30";
          const backupIntervalStr = await getSetting("backup_interval") || "Weekly";
          const backupDirectoryStr = await getSetting("backup_directory") || "";
          const backupRetentionStr = await getSetting("backup_retention") || "5";

          const parsedTimeout = parseInt(timeoutStr, 10);
          const captureProtected = captureProtectedStr === "true";
          
          set({
            idleTimeout: isNaN(parsedTimeout) ? 300 : parsedTimeout,
            lockOnFocusLost: focusLostStr === "true",
            screenCaptureProtected: captureProtected,
            autotypeShortcut: shortcutStr,
            theme: themeStr,
            autotypeDelay: parseInt(autotypeDelayStr, 10) || 50,
            clipboardTimeout: parseInt(clipboardTimeoutStr, 10) || 30,
            backupInterval: backupIntervalStr,
            backupDirectory: backupDirectoryStr,
            backupRetention: parseInt(backupRetentionStr, 10) || 5,
          });

          console.log("[Settings Load] screen_capture_protected =", captureProtected);
          console.log("[Settings Load] autotype_shortcut =", shortcutStr);

          try {
            await setScreenCaptureProtection(captureProtected);
          } catch (e) {
            console.error("Failed to apply initial screen capture protection:", e);
          }

          try {
            await updateAutotypeShortcut(shortcutStr);
          } catch (e) {
            console.error("Failed to register autotype shortcut on load:", e);
          }
        } catch (err: any) {
          // Set defaults if settings load fails before database is open
        }
      },

      updateSetting: async (key: string, value: string) => {
        try {
          await setSetting(key, value);
          console.log(`[Settings Sync] ${key} = ${value}`);
          try {
            const friendlyNames: Record<string, string> = {
              idle_timeout: "Idle timeout",
              lock_on_focus_lost: "Lock on focus lost",
              screen_capture_protected: "Screen capture protection",
              autotype_shortcut: "Autotype global shortcut",
              theme: "App theme",
              autotype_delay: "Autotype inter-key delay",
              clipboard_timeout: "Clipboard auto-clear timeout",
              backup_interval: "Backup frequency interval",
              backup_directory: "Backup target directory",
              backup_retention: "Backup version retention",
              autostart: "Start Clavis at OS login",
              lock_on_ext_disconnect: "Lock on browser extension disconnect"
            };
            const friendlyKey = friendlyNames[key] || key;
            const displayVal = value === "true" ? "Enabled" : value === "false" ? "Disabled" : value;
            logEvent("Setting changed", friendlyKey, `Value updated to: ${displayVal}`);
          } catch {}
          if (key === "idle_timeout") {
            const parsedValue = parseInt(value, 10);
            set({ idleTimeout: isNaN(parsedValue) ? 300 : parsedValue });
          } else if (key === "lock_on_focus_lost") {
            set({ lockOnFocusLost: value === "true" });
          } else if (key === "screen_capture_protected") {
            const enabled = value === "true";
            set({ screenCaptureProtected: enabled });
            try {
              await setScreenCaptureProtection(enabled);
            } catch (e) {
              console.error("Failed to toggle screen capture protection:", e);
            }
          } else if (key === "autotype_shortcut") {
            set({ autotypeShortcut: value });
            try {
              await updateAutotypeShortcut(value);
            } catch (e) {
              console.error("Failed to update autotype shortcut:", e);
            }
          } else if (key === "theme") {
            set({ theme: value });
          } else if (key === "autotype_delay") {
            set({ autotypeDelay: parseInt(value, 10) || 50 });
          } else if (key === "clipboard_timeout") {
            set({ clipboardTimeout: parseInt(value, 10) || 30 });
          } else if (key === "backup_interval") {
            set({ backupInterval: value });
          } else if (key === "backup_directory") {
            set({ backupDirectory: value });
          } else if (key === "backup_retention") {
            set({ backupRetention: parseInt(value, 10) || 5 });
          }
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        }
      },

      startClipboardCountdown: () => {
        if (globalClipboardInterval) {
          clearInterval(globalClipboardInterval);
        }
        set({ clipboardCountdown: 30 });
        globalClipboardInterval = setInterval(() => {
          const count = get().clipboardCountdown;
          if (count === null || count <= 1) {
            clearInterval(globalClipboardInterval);
            globalClipboardInterval = null;
            set({ clipboardCountdown: null });
          } else {
            set({ clipboardCountdown: count - 1 });
          }
        }, 1000);
      },

      clearClipboardCountdown: () => {
        if (globalClipboardInterval) {
          clearInterval(globalClipboardInterval);
          globalClipboardInterval = null;
        }
        set({ clipboardCountdown: null });
      },
    }));