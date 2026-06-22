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

export interface GeneratePasswordOptions {
  length: number;
  useUpper?: boolean;
  useLower?: boolean;
  useNumbers?: boolean;
  useSymbols?: boolean;
}
