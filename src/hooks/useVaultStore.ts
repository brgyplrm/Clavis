import { create } from "zustand";
import {
  Vault,
  EntrySummary,
  isVaultInitialized,
  isVaultLocked,
  unlockVault,
  lockVault,
  createVault,
  listVaults,
  deleteVault,
  createEntry,
  listEntries,
  updateEntry,
  deleteEntry
} from "../lib/tauri";
import { scorePassword } from "../lib/passwordStrength";
import { logEvent } from "../lib/activity";

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}


interface VaultState {
  isInitialized: boolean;
  isLocked: boolean;
  vaults: Vault[];
  activeVault: Vault | null;
  entries: EntrySummary[];
  loading: boolean;
  error: string | null;

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
}

export const useVaultStore = create<VaultState>((set, get) => ({
  isInitialized: false,
  isLocked: true,
  vaults: [],
  activeVault: null,
  entries: [],
  loading: false,
  error: null,

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
      if (!locked && get().vaults.length === 0) {
        await get().fetchVaults();
      }
    } catch (err: any) {
      set({ error: err.toString() });
    }
  },

   unlock: async (password: string) => {
    set({ loading: true, error: null });
    try {
      await unlockVault(password);
      set({ isLocked: false, isInitialized: true });
      logEvent("Unlocked", "—", "Master password");
      await get().fetchVaults();
    } catch (err: any) {
      logEvent("Failed unlock", "—", "Attempt failed");
      set({ error: err.toString() });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  lock: async () => {
    set({ loading: true });
    try {
      await lockVault();
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
      throw err;
    } finally {
      set({ loading: false });
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
      const newVault = await createVault(name);
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
      const entry = await createEntry(active.id, title, username, passwordPlaintext, totpSecretPlaintext);
      
      // Save password metadata
      try {
        const hash = simpleHash(passwordPlaintext);
        const { score } = scorePassword(passwordPlaintext);
        
        const hashes = JSON.parse(localStorage.getItem("clavis_password_hashes") || "{}");
        hashes[entry.id] = hash;
        localStorage.setItem("clavis_password_hashes", JSON.stringify(hashes));

        const scores = JSON.parse(localStorage.getItem("clavis_password_scores") || "{}");
        scores[entry.id] = score;
        localStorage.setItem("clavis_password_scores", JSON.stringify(scores));

        const commonBreached = ["password", "password123", "123456", "admin", "12345678", "qwerty"];
        const isCommon = commonBreached.includes(passwordPlaintext.toLowerCase());
        const breached = JSON.parse(localStorage.getItem("clavis_password_breached") || "{}");
        if (isCommon) {
          breached[entry.id] = true;
        } else {
          delete breached[entry.id];
        }
        localStorage.setItem("clavis_password_breached", JSON.stringify(breached));
      } catch (e) {
        console.error("Failed to save entry password metadata:", e);
      }

      logEvent("Entry added", title, "—");
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

      // Save password metadata
      try {
        const hash = simpleHash(passwordPlaintext);
        const { score } = scorePassword(passwordPlaintext);
        
        const hashes = JSON.parse(localStorage.getItem("clavis_password_hashes") || "{}");
        hashes[id] = hash;
        localStorage.setItem("clavis_password_hashes", JSON.stringify(hashes));

        const scores = JSON.parse(localStorage.getItem("clavis_password_scores") || "{}");
        scores[id] = score;
        localStorage.setItem("clavis_password_scores", JSON.stringify(scores));

        const commonBreached = ["password", "password123", "123456", "admin", "12345678", "qwerty"];
        const isCommon = commonBreached.includes(passwordPlaintext.toLowerCase());
        const breached = JSON.parse(localStorage.getItem("clavis_password_breached") || "{}");
        if (isCommon) {
          breached[id] = true;
        } else {
          delete breached[id];
        }
        localStorage.setItem("clavis_password_breached", JSON.stringify(breached));
      } catch (e) {
        console.error("Failed to save entry password metadata:", e);
      }

      logEvent("Entry added", title, "Updated");
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
      const entryToDelete = get().entries.find(e => e.id === id);
      const title = entryToDelete ? entryToDelete.title : "—";
      
      await deleteEntry(id);

      // Clean up metadata
      try {
        ["clavis_password_hashes", "clavis_password_scores", "clavis_password_breached", "clavis_categories", "clavis_tags", "clavis_attachments", "clavis_urls", "clavis_notes"].forEach(key => {
          const map = JSON.parse(localStorage.getItem(key) || "{}");
          delete map[id];
          localStorage.setItem(key, JSON.stringify(map));
        });
      } catch (e) {
        console.error("Failed to clear entry password metadata:", e);
      }

      logEvent("Entry deleted", title, "—");
      await get().fetchEntries();
    } catch (err: any) {
      set({ error: err.toString() });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));