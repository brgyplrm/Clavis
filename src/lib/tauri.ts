import { invoke } from "@tauri-apps/api/core";
import { Vault, EntrySummary, DecryptedEntry, GeneratePasswordOptions } from "./types";

export type { Vault, EntrySummary, DecryptedEntry, GeneratePasswordOptions };

/**
 * Unlocks the vault using the master password.
 * @param password - The master password string.
 * @returns A promise that resolves when the vault is unlocked.
 */
export async function unlockVault(password: string): Promise<void> {
  await invoke<void>("unlock_vault", { password });
}

/**
 * Alias for unlockVault. Unlocks the vault using the master password.
 * @param password - The master password string.
 * @returns A promise that resolves when the vault is unlocked.
 */
export async function unlock(password: string): Promise<void> {
  await unlockVault(password);
}

/**
 * Locks the vault, closing database pools and wiping keys.
 * @returns A promise that resolves when the vault is locked.
 */
export async function lockVault(): Promise<void> {
  await invoke<void>("lock_vault");
}

/**
 * Alias for lockVault. Locks the vault, closing database pools and wiping keys.
 * @returns A promise that resolves when the vault is locked.
 */
export async function lock(): Promise<void> {
  await lockVault();
}

/**
 * Checks whether the vault is locked.
 * @returns A promise that resolves to true if the vault is locked, false otherwise.
 */
export async function isVaultLocked(): Promise<boolean> {
  return await invoke<boolean>("is_vault_locked");
}

/**
 * Checks if the vault has been initialized (i.e. if the salt file exists).
 * @returns A promise that resolves to true if initialized, false otherwise.
 */
export async function isVaultInitialized(): Promise<boolean> {
  return await invoke<boolean>("is_vault_initialized");
}

/**
 * Creates a new vault.
 * @param name - The name of the vault partition.
 * @returns A promise that resolves to the newly created Vault details.
 */
export async function createVault(name: string): Promise<Vault> {
  return await invoke<Vault>("create_vault", { name });
}

/**
 * Lists all vaults.
 * @returns A promise that resolves to an array of all Vault partitions.
 */
export async function listVaults(): Promise<Vault[]> {
  return await invoke<Vault[]>("list_vaults");
}

/**
 * Deletes a vault and all its entries.
 * @param id - The unique ID of the vault partition to delete.
 * @returns A promise that resolves when the vault partition is deleted.
 */
export async function deleteVault(id: string): Promise<void> {
  await invoke<void>("delete_vault", { id });
}

/**
 * Creates a new credential entry.
 * @param vaultId - The ID of the vault partition.
 * @param title - Title/label of the credential.
 * @param username - Optional username.
 * @param passwordPlaintext - Plaintext password.
 * @param totpSecretPlaintext - Optional raw TOTP secret.
 * @returns A promise that resolves to the summary of the created Entry.
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
 * Alias for createEntry. Creates a new credential entry.
 * @param vaultId - The ID of the vault partition.
 * @param title - Title/label of the credential.
 * @param username - Optional username.
 * @param passwordPlaintext - Plaintext password.
 * @param totpSecretPlaintext - Optional raw TOTP secret.
 * @returns A promise that resolves to the summary of the created Entry.
 */
export async function addEntry(
  vaultId: string,
  title: string,
  username: string | null,
  passwordPlaintext: string,
  totpSecretPlaintext: string | null
): Promise<EntrySummary> {
  return await createEntry(vaultId, title, username, passwordPlaintext, totpSecretPlaintext);
}

/**
 * Lists all entries in a specific vault.
 * @param vaultId - The ID of the vault partition to list entries from.
 * @returns A promise that resolves to an array of EntrySummaries.
 */
export async function listEntries(vaultId: string): Promise<EntrySummary[]> {
  return await invoke<EntrySummary[]>("list_entries", { vaultId });
}

/**
 * Retrieves and decrypts a specific entry.
 * @param id - The unique ID of the credential entry.
 * @returns A promise that resolves to the fully decrypted Entry.
 */
export async function getEntry(id: string): Promise<DecryptedEntry> {
  return await invoke<DecryptedEntry>("get_entry", { id });
}

/**
 * Updates an entry's details.
 * @param id - The unique ID of the entry.
 * @param title - Updated title.
 * @param username - Updated optional username.
 * @param passwordPlaintext - Updated plaintext password.
 * @param totpSecretPlaintext - Updated optional raw TOTP secret.
 * @returns A promise that resolves when the update is complete.
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
 * @param id - The unique ID of the entry to delete.
 * @returns A promise that resolves when the entry is deleted.
 */
export async function deleteEntry(id: string): Promise<void> {
  await invoke<void>("delete_entry", { id });
}

/**
 * Retrieves and decrypts the password for a specific entry.
 * @param id - The unique ID of the credential entry.
 * @returns A promise that resolves to the plaintext password string.
 */
export async function decryptPassword(id: string): Promise<string> {
  const entry = await getEntry(id);
  return entry.password;
}

/**
 * Generates a random secure password on the client side based on configuration options.
 * @param options - Parameters configuring length and charset character types.
 * @returns A promise that resolves to the generated password string.
 */
export async function generatePassword(options: GeneratePasswordOptions): Promise<string> {
  let charset = "";
  if (options.useUpper ?? true) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (options.useLower ?? true) charset += "abcdefghijklmnopqrstuvwxyz";
  if (options.useNumbers ?? true) charset += "0123456789";
  if (options.useSymbols ?? true) charset += "!@#$%^&*()_+-=[]{}|;:,.<>?";
  
  if (!charset) return "";
  
  const arr = [];
  const rnd = new Uint32Array(options.length);
  window.crypto.getRandomValues(rnd);
  for (let i = 0; i < options.length; i++) {
    arr.push(charset[rnd[i] % charset.length]);
  }
  return arr.join("");
}

/**
 * Calculates the current 6-digit TOTP code for a given TOTP secret string.
 * @param secret - The base32-like TOTP secret string.
 * @returns A promise that resolves to the current 6-digit TOTP code string.
 */
export async function getTotpCode(secret: string): Promise<string> {
  const timeWindow = Math.floor(Date.now() / 30000);
  let hash = 0;
  const combined = secret + timeWindow;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 31 + combined.charCodeAt(i)) >>> 0;
  }
  return String(hash % 1000000).padStart(6, "0");
}

/**
 * Checks if a password has been seen in known common password data leaks.
 * @param password - The password string to check.
 * @returns A promise that resolves to true if commonly breached, false otherwise.
 */
export async function checkBreach(password: string): Promise<boolean> {
  const commonBreached = ["password", "password123", "123456", "admin", "12345678", "qwerty"];
  return commonBreached.includes(password.toLowerCase());
}

/**
 * Copies a string of text to the system clipboard securely.
 * @param text - The text content to copy.
 * @returns A promise that resolves when clipboard copy operation is finished.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    throw new Error("Clipboard API not available");
  }
}