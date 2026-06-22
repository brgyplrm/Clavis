use crate::error::{Error, Result};
use argon2::{Algorithm, Argon2, ParamsBuilder, Version};
use zeroize::Zeroizing;

/// Derives a 32-byte key from the master password and salt using Argon2id.
///
/// Returns a 32-byte array wrapped in `Zeroizing` to ensure the derived key
/// is safely zeroed from memory when dropped.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    let mut derived = [0u8; 32];

    // Configure Argon2id params exactly to spec: m=65536, t=3, p=4
    let params = ParamsBuilder::new()
        .m_cost(65536)
        .t_cost(3)
        .p_cost(4)
        .output_len(32)
        .build()
        .map_err(|e| Error::Argon2(e.to_string()))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    argon2
        .hash_password_into(password.as_bytes(), salt, &mut derived)
        .map_err(|e| Error::Argon2(e.to_string()))?;

    Ok(Zeroizing::new(derived))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kdf_determinism() {
        let password = "SuperSecretPassword123!";
        let salt = b"16byte-long-salt"; // Exactly 16 bytes

        let key1 = derive_key(password, salt).unwrap();
        let key2 = derive_key(password, salt).unwrap();

        assert_eq!(
            *key1, *key2,
            "Same password + salt must produce the identical key"
        );
    }

    #[test]
    fn test_kdf_different_salt() {
        let password = "SuperSecretPassword123!";
        let salt1 = b"16byte-long-salt";
        let salt2 = b"different-salt-1";

        let key1 = derive_key(password, salt1).unwrap();
        let key2 = derive_key(password, salt2).unwrap();

        assert_ne!(*key1, *key2, "Different salts must produce different keys");
    }
}
