'use strict';
/**
 * Port of the legacy .NET CryptorEngine.
 * Original: TripleDES / ECB / PKCS7, key = MD5(passphrase) (16 bytes ->
 * .NET expands a 16-byte TripleDES key to K1|K2|K1 = 24 bytes), Base64 I/O.
 *
 * Kept only so existing encrypted config values (e.g. the email password)
 * keep working unchanged. Do NOT treat this as strong crypto.
 */
const crypto = require('crypto');

function tripleDesKey(passphrase) {
  const md5 = crypto.createHash('md5').update(passphrase, 'utf8').digest(); // 16 bytes
  return Buffer.concat([md5, md5.subarray(0, 8)]); // -> 24 bytes (K1|K2|K1)
}

function decrypt(cipherB64, passphrase, useHashing = true) {
  const key = useHashing ? tripleDesKey(passphrase) : Buffer.from(passphrase, 'utf8');
  const decipher = crypto.createDecipheriv('des-ede3', key, null); // ECB
  decipher.setAutoPadding(true); // PKCS7
  const input = Buffer.from(cipherB64, 'base64');
  return Buffer.concat([decipher.update(input), decipher.final()]).toString('utf8');
}

function encrypt(plain, passphrase, useHashing = true) {
  const key = useHashing ? tripleDesKey(passphrase) : Buffer.from(passphrase, 'utf8');
  const cipher = crypto.createCipheriv('des-ede3', key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

module.exports = { encrypt, decrypt };
