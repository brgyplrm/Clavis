import crypto from 'crypto';

// Generate RSA key pair
const { publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'der'
  }
});

// Chrome Extension ID calculation:
// 1. Take SHA256 of the SPKI DER public key
const sha256 = crypto.createHash('sha256').update(publicKey).digest();

// 2. Take the first 16 bytes (32 hex characters)
const hex = sha256.toString('hex').substring(0, 32);

// 3. Map hex chars 0-f to letters a-p
// 0->a, 1->b, ... f->p
const extensionId = hex
  .split('')
  .map(char => String.fromCharCode(parseInt(char, 16) + 97))
  .join('');

// Format public key in Base64 SPKI
const publicKeySpkiPem = publicKey.toString('base64');

console.log('Extension ID:', extensionId);
console.log('PublicKey (for manifest.json "key" field):');
console.log(publicKeySpkiPem);
