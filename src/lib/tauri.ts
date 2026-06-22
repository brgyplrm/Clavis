   import { invoke } from "@tauri-apps/api/core";

    export interface Vault {
      id: string;
      name: string;
      created_at: number;
      updated_at: number;
    }

    export interface EntrySummary {
      id: string;
      vault_id: string;
      title: string;
      username: string | null;
      has_totp: boolean;
      created_at: number;
      updated_at: number;
    }

    export interface DecryptedEntry {
      id: string;
      vault_id: string;
      title: string;
      username: string | null;
      password: string;
      totp_secret: string | null;
      created_at: number;
      updated_at: number;
    }

    /**
     * Unlocks the vault using the master password.
     */
    export async function unlockVault(password: string): Promise<void> {
      await invoke<void>("unlock_vault", { password });
    }

    /**
     * Locks the vault, closing database pools and wiping keys.
     */
    export async function lockVault(): Promise<void> {
      await invoke<void>("lock_vault");
    }

    /**
     * Checks whether the vault is locked.
     */
    export async function isVaultLocked(): Promise<boolean> {
      return await invoke<boolean>("is_vault_locked");
    }

    /**
     * Creates a new vault.
     */
    export async function createVault(name: string): Promise<Vault> {
      return await invoke<Vault>("create_vault", { name });
    }

    /**
     * Lists all vaults.
     */
    export async function listVaults(): Promise<Vault[]> {
      return await invoke<Vault[]>("list_vaults");
    }

    /**
     * Deletes a vault and all its entries.
     */
    export async function deleteVault(id: string): Promise<void> {
      await invoke<void>("delete_vault", { id });
    }

    /**
     * Creates a new credential entry.
     */
    export async function createEntry(
      vaultId: string,
      title: string,
      username: string | null,
      passwordPlaintext: string,
      totpSecretPlaintext: string | null
    ): Promise<EntrySummary> {
      return await invoke<EntrySummary>("create_entry", {
        vaultId,
        title,
        username,
        passwordPlaintext,
        totpSecretPlaintext,
      });
    }

    /**
     * Lists all entries in a specific vault.
     */
    export async function listEntries(vaultId: string): Promise<EntrySummary[]> {
      return await invoke<EntrySummary[]>("list_entries", { vaultId });
    }

    /**
     * Retrieves and decrypts a specific entry.
     */
    export async function getEntry(id: string): Promise<DecryptedEntry> {
      return await invoke<DecryptedEntry>("get_entry", { id });
    }

    /**
     * Updates an entry's details.
     */
    export async function updateEntry(
      id: string,
      title: string,
      username: string | null,
      passwordPlaintext: string,
      totpSecretPlaintext: string | null
    ): Promise<void> {
      await invoke<void>("update_entry", {
        id,
        title,
        username,
        passwordPlaintext,
        totpSecretPlaintext,
      });
    }

    /**
     * Deletes an entry.
     */
    export async function deleteEntry(id: string): Promise<void> {
      await invoke<void>("delete_entry", { id });
    }