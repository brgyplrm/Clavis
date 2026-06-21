
import { invoke } from "@tauri-apps/api/core";

/**
 * Attempts to unlock the vault using the master password.
 */
export async function unlockVault(password: string): Promise<void> {
  await invoke<void>("unlock_vault", { password });
}

/**
 * Instantly locks the vault, clearing session keys and closing DB pools.
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