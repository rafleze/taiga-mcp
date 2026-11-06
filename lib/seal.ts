// Token "sigillati": payload JSON cifrato e autenticato con AES-256-GCM.
// Il server non ha database: client_id, codici di autorizzazione, access token
// e refresh token contengono tutto lo stato necessario, leggibile solo da chi
// conosce TOKEN_SECRET.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type SealKind = "client" | "code" | "access" | "refresh";

function key(): Buffer {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("TOKEN_SECRET mancante o troppo corto (almeno 32 caratteri)");
  }
  return createHash("sha256").update(secret).digest();
}

export function seal(kind: SealKind, payload: Record<string, unknown>, ttlSeconds?: number): string {
  const body: Record<string, unknown> = { ...payload, k: kind };
  if (ttlSeconds) body.exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(kind));
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `tg_${kind}_` + Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function unseal<T = Record<string, unknown>>(kind: SealKind, token: string | undefined | null): (T & { exp?: number }) | null {
  if (!token) return null;
  const prefix = `tg_${kind}_`;
  if (!token.startsWith(prefix)) return null;
  try {
    const raw = Buffer.from(token.slice(prefix.length), "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(Buffer.from(kind));
    decipher.setAuthTag(tag);
    const body = JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
    if (body.k !== kind) return null;
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

export function sha256b64url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}
