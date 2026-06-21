
use argon2::{
    Argon2, Version,
    ParamsBuilder,
};
use secrecy::{SecretVec};
use crate::error::{Error, Result};

    /// Derives a 32-byte key from the master password and salt.
    pub fn derive_key(password: &str, salt: &[u8]) -> Result<SecretVec<u8>> {
        let mut derived = vec![0u8; 32];

        // Configure Argon2id params: m=65536, t=3, p=4
        let params = ParamsBuilder::new()
            .m_cost(65536)
            .t_cost(3)
            .p_cost(4)
            .output_len(32)
            .build()
            .map_err(|e| Error::Argon2(e.to_string()))?;

        let argon2 = Argon2::new(
            argon2::Algorithm::Argon2id,
            Version::V0x13,
            params
        );

        argon2
            .hash_password_into(password.as_bytes(), salt, &mut derived)
            .map_err(|e| Error::Argon2(e.to_string()))?;

        Ok(SecretVec::new(derived))
    }