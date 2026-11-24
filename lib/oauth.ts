// Mini server di autorizzazione OAuth 2.1 stateless (DCR + PKCE S256 + refresh).
import { allowedRedirectHosts } from "./config";
import { sha256b64url, unseal } from "./seal";

export type ClientInfo = { r: string[]; n?: string };

export function getClient(clientId: string | null): ClientInfo | null {
  return unseal<ClientInfo>("client", clientId);
}

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Regole sul redirect_uri in sé: https oppure http su loopback; con ALLOWED_REDIRECT_HOSTS
 * gli https sono limitati agli host elencati. Restituisce il motivo del rifiuto, o null.
 */
export function redirectUriProblem(uri: string): string | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return "redirect_uri non valido";
  }
  if (u.protocol === "http:" && LOOPBACK.includes(u.hostname)) return null;
  if (u.protocol !== "https:") return "Sono ammessi solo https o loopback";
  const hosts = allowedRedirectHosts();
  if (hosts && !hosts.includes(u.hostname.toLowerCase())) return "Host del redirect_uri non ammesso da questo server";
  return null;
}

/** Confronto redirect_uri; per i loopback (Claude Code) la porta viene ignorata, come da RFC 8252 */
export function redirectAllowed(client: ClientInfo, redirectUri: string): boolean {
  // rivalutato a ogni richiesta: vale anche per i client registrati prima di impostare ALLOWED_REDIRECT_HOSTS
  if (redirectUriProblem(redirectUri)) return false;
  if (client.r.includes(redirectUri)) return true;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" || !LOOPBACK.includes(u.hostname)) return false;
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
