// Hybrid encryption for the published listings files: a fresh AES-256-GCM key per file, wrapped with the
// RSA-OAEP public key that lives in Supabase. Only the ingest-places Edge Function holds the private key.
// The function carries its own copy of decryptJson (it is deployed as one file); tests/overture.test.mjs
// checks the two stay compatible.
const { subtle } = globalThis.crypto;
const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

export async function encryptJson(publicJwk, value) {
  const pub = await subtle.importKey('jwk', publicJwk, RSA, false, ['wrapKey']);
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(value)));
  const ek = await subtle.wrapKey('raw', aes, pub, RSA);
  return { v: 1, alg: 'RSA-OAEP-256+A256GCM', ek: b64(ek), iv: b64(iv), ct: b64(ct) };
}

export async function decryptJson(privateJwk, env) {
  const priv = await subtle.importKey('jwk', privateJwk, RSA, false, ['unwrapKey']);
  const aes = await subtle.unwrapKey('raw', unb64(env.ek), priv, RSA, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, aes, unb64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function generateKeyPair() {
  const kp = await subtle.generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['wrapKey', 'unwrapKey']);
  return { publicJwk: await subtle.exportKey('jwk', kp.publicKey), privateJwk: await subtle.exportKey('jwk', kp.privateKey) };
}
