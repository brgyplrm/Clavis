
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
 * Initializes the database on first-time setup with the master password.
 */
export async function createVault(password: string): Promise<void> {
  await invoke<void>("create_vault", { password });
}

/**
 * Unlocks the existing database using the master password.
 */
export async function unlock(password: string): Promise<void> {
  await invoke<void>("unlock", { password });
}

/**
 * Locks the vault, closing database pools and wiping keys.
 */
export async function lock(): Promise<void> {
  await invoke<void>("lock");
}

/**
 * Checks whether the vault is locked.
 */
export async function isVaultLocked(): Promise<boolean> {
  return await invoke<boolean>("is_vault_locked");
}

/**
 * Checks if the vault has been initialized (i.e. if the salt file exists).
 */
export async function isVaultInitialized(): Promise<boolean> {
  return await invoke<boolean>("is_vault_initialized");
}

/**
 * Creates a new vault partition inside the database.
 */
export async function createVaultPartition(name: string): Promise<Vault> {
  return await invoke<Vault>("create_vault_partition", { name });
}

/**
 * Lists all vaults in the database.
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

/**
 * Retrieves a setting from the database.
 */
export async function getSetting(key: string): Promise<string> {
  return await invoke<string>("get_setting", { key });
}

/**
 * Updates or inserts a setting in the database.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await invoke<void>("set_setting", { key, value });
}

export interface TotpResponse {
  code: string;
  seconds_remaining: number;
}

/**
 * Retrieves the current TOTP code and remaining seconds for a given entry ID.
 */
export async function getTotpCode(entryId: string): Promise<TotpResponse> {
  return await invoke<TotpResponse>("get_totp_code", { entryId });
}

export interface CaptureSource {
  id: string;
  name: string;
  source_type: "screen" | "window";
  app_name: string | null;
  title: string | null;
  width: number;
  height: number;
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  return await invoke<CaptureSource[]>("list_capture_sources");
}

export async function captureSource(id: string): Promise<string> {
  return await invoke<string>("capture_source", { id });
}

/**
 * Copies sensitive text to the system clipboard and schedules an automatic clear after 30 seconds.
 */
export async function copyToClipboard(text: string): Promise<void> {
  await invoke<void>("copy_to_clipboard", { text });
}

export interface BreachCheckResponse {
  count: number;
}

/**
 * Checks a password against the HaveIBeenPwned API using k-anonymity.
 */
export async function checkPasswordBreached(password: string): Promise<BreachCheckResponse> {
  return await invoke<BreachCheckResponse>("check_password_breached", { password });
}

export interface Breach {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  AddedDate: string;
  PwnCount: number;
  Description: string;
  DataClasses: string[];
  LogoPath: string;
}

/**
 * Retrieves the local cached data breaches list, if it exists.
 */
export async function getCachedBreaches(): Promise<string | null> {
  return await invoke<string | null>("get_cached_breaches");
}

/**
 * Fetches data breaches list from HaveIBeenPwned API and caches it locally.
 */
export async function updateBreachesCache(): Promise<string> {
  return await invoke<string>("update_breaches_cache");
}

export interface PasswordGeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
}

/**
 * Generates a random secure password using the Rust CSPRNG backend.
 */
export async function generatePassword(options: PasswordGeneratorOptions): Promise<string> {
  return await invoke<string>("generate_password", {
    length: options.length,
    uppercase: options.uppercase,
    lowercase: options.lowercase,
    digits: options.digits,
    symbols: options.symbols,
  });
}