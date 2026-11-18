import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 8;

function keyFor(secret: string): Buffer {
  return createHash("sha256").update(`nepo-draft-link:${secret}`).digest();
}

/**
 * The tap-to-send link has to find the intro on any server instance, and the
 * app only returns an intro to the phone that requested it. So the link carries
 * that phone, encrypted with a key derived from WEBHOOK_SECRET and bound to the
 * intro id. Nobody holding the link can read the phone or reuse it for another intro.
 */
export function sealRequesterPhone(introId: string, phone: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(introId));
  const sealed = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString("base64url");
}

/** The requester's phone from a link token, or null if the token is not valid for this intro. */
export function openRequesterPhone(introId: string, token: string, secret: string): string | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES || raw.length > 64) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, IV_BYTES), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(introId));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const sealed = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    return Buffer.concat([decipher.update(sealed), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
