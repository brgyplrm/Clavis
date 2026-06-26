    import { create } from "zustand";

let globalClipboardInterval: any = null;
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
      setSetting
    } from "../lib/tauri";

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
      clipboardCountdown: number | null;
      startClipboardCountdown: () => void;
      clearClipboardCountdown: () => void;

      checkInitialization: () => Promise<void>;
      checkLockStatus: () => Promise<void>;
      unlock: (password: string) => Promise<void>;
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
    }

    export const useVaultStore = create<VaultState>((set, get) => ({
      isInitialized: false,
      isLocked: true,
      vaults: [],
      activeVault: null,
      entries: [],
      loading: false,
      error: null,
      idleTimeout: 300, // Default 5 minutes
      lockOnFocusLost: false, // Default off
      clipboardCountdown: null,

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

      lock: async () => {
        set({ loading: true });
        try {
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
          const parsedTimeout = parseInt(timeoutStr, 10);
          set({
            idleTimeout: isNaN(parsedTimeout) ? 300 : parsedTimeout,
            lockOnFocusLost: focusLostStr === "true",
          });
        } catch (err: any) {
          // Set defaults if settings load fails before database is open
        }
      },

      updateSetting: async (key: string, value: string) => {
        try {
          await setSetting(key, value);
          if (key === "idle_timeout") {
            const parsedValue = parseInt(value, 10);
            set({ idleTimeout: isNaN(parsedValue) ? 300 : parsedValue });
          } else if (key === "lock_on_focus_lost") {
            set({ lockOnFocusLost: value === "true" });
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