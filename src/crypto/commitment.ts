const SALT_BYTES = 16;
const SEED_BYTES = 16;

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hash(value: string, salt: Uint8Array): Promise<string> {
  const valueBytes = new TextEncoder().encode(value);
  const payload = new Uint8Array(salt.length + valueBytes.length);
  payload.set(salt, 0);
  payload.set(valueBytes, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return toHex(digest);
}

/** SHA-256 commitment to `value`, salted so equal values don't collide. */
export function commit(value: string, salt: Uint8Array): Promise<string> {
  return hash(value, salt);
}

/** Whether `value` + `salt` reproduces the given commitment. */
export async function verify(
  value: string,
  salt: Uint8Array,
  commitment: string,
): Promise<boolean> {
  return (await hash(value, salt)) === commitment;
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export function generateSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SEED_BYTES));
}

/** Hex-encode a salt for wire transport (Firebase can't store Uint8Array). */
export function saltToHex(salt: Uint8Array): string {
  return Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Decode a hex-encoded salt from wire transport back to Uint8Array. */
export function hexToSalt(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
