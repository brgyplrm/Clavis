use crate::error::{Error, Result};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use ring::rand::{SecureRandom, SystemRandom};

/// Encrypts plaintext bytes using AES-256-GCM and a 32-byte key.
/// Returns a tuple of (ciphertext, nonce).
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| Error::Crypto(e.to_string()))?;

    // Generate secure 96-bit (12-byte) nonce
    let mut nonce_bytes = [0u8; 12];
    let rng = SystemRandom::new();
    rng.fill(&mut nonce_bytes)
        .map_err(|_| Error::Crypto("Failed to generate secure nonce".to_string()))?;

    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| Error::Crypto(e.to_string()))?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// Decrypts ciphertext bytes using AES-256-GCM and a 32-byte key.
pub fn decrypt(key: &[u8; 32], ciphertext: &[u8], nonce: &[u8]) -> Result<Vec<u8>> {
    if nonce.len() != 12 {
        return Err(Error::Crypto("Invalid nonce length".to_string()));
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| Error::Crypto(e.to_string()))?;

    let nonce = Nonce::from_slice(nonce);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| Error::Crypto(e.to_string()))?;

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_trip() {
        let key = [7u8; 32];
        let message = b"Hello, secure world!";

        let (ciphertext, nonce) = encrypt(&key, message).unwrap();
        let decrypted = decrypt(&key, &ciphertext, &nonce).unwrap();

        assert_eq!(
            message.to_vec(),
            decrypted,
            "Decrypted message must match original"
        );
    }

    #[test]
    fn test_wrong_key() {
        let key1 = [7u8; 32];
        let key2 = [8u8; 32];
        let message = b"Confidential Data";

        let (ciphertext, nonce) = encrypt(&key1, message).unwrap();
        let decrypted_res = decrypt(&key2, &ciphertext, &nonce);

        assert!(
            decrypted_res.is_err(),
            "Decryption with wrong key must fail"
        );
    }

    #[test]
    fn test_corrupt_ciphertext() {
        let key = [7u8; 32];
        let message = b"Tamper-proof message";

        let (mut ciphertext, nonce) = encrypt(&key, message).unwrap();

        // Flip the first byte to corrupt ciphertext
        if !ciphertext.is_empty() {
            ciphertext[0] ^= 0xFF;
        }

        let decrypted_res = decrypt(&key, &ciphertext, &nonce);
        assert!(
            decrypted_res.is_err(),
            "Decryption of corrupted ciphertext must fail"
        );
    }
}
