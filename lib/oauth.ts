// Mini server di autorizzazione OAuth 2.1 stateless (DCR + PKCE S256 + refresh).
import { sha256b64url, unseal } from "./seal";

export type ClientInfo = { r: string[]; n?: string };

export function getClient(clientId: string | null): ClientInfo | null {
  return unseal<ClientInfo>("client", clientId);
}

/** Confronto redirect_uri; per i loopback (Claude Code) la porta viene ignorata, come da RFC 8252 */
export function redirectAllowed(client: ClientInfo, redirectUri: string): boolean {
  if (client.r.includes(redirectUri)) return true;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return false;
  return client.r.some((r) => {
    try {
      const x = new URL(r);
      return x.protocol === "http:" && x.hostname === u.hostname && x.pathname === u.pathname;
    } catch {
      return false;
    }
  });
}

export function pkceOk(verifier: string | null, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  return sha256b64url(verifier) === challenge;
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    },
  });
}

export function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status);
}

export function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
    },
  });
}
