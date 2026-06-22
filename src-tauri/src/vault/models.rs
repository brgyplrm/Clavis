use serde::{Deserialize, Serialize};

/// Represents a vault container.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Vault {
    /// The unique UUID of the vault.
    pub id: String,
    /// The display name of the vault.
    pub name: String,
    /// The Unix timestamp when the vault was created.
    pub created_at: i64,
    /// The Unix timestamp when the vault was last updated.
    pub updated_at: i64,
}

/// Represents the decrypted entry summary returned for listings.
/// The password field is excluded here for security, and is retrieved on-demand.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntrySummary {
    /// The unique UUID of the entry.
    pub id: String,
    /// The ID of the vault this entry belongs to.
    pub vault_id: String,
    /// The display title of the entry.
    pub title: String,
    /// The username associated with the credential.
    pub username: Option<String>,
    /// Whether this entry has a TOTP secret configured.
    pub has_totp: bool,
    /// The Unix timestamp when the entry was created.
    pub created_at: i64,
    /// The Unix timestamp when the entry was last updated.
    pub updated_at: i64,
}

/// Represents the fully decrypted entry for viewing/editing.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DecryptedEntry {
    /// The unique UUID of the entry.
    pub id: String,
    /// The ID of the vault this entry belongs to.
    pub vault_id: String,
    /// The display title of the entry.
    pub title: String,
    /// The username associated with the credential.
    pub username: Option<String>,
    /// The decrypted password string.
    pub password: String,
    /// The decrypted TOTP secret string.
    pub totp_secret: Option<String>,
    /// The Unix timestamp when the entry was created.
    pub created_at: i64,
    /// The Unix timestamp when the entry was last updated.
    pub updated_at: i64,
}
