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
