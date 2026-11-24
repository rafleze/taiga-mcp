// Token endpoint: scambio del codice (con verifica PKCE) e refresh con rotazione.
import { ACCESS_TTL, REFRESH_TTL } from "@/lib/config";
import { cors, json, oauthError, pkceOk } from "@/lib/oauth";
import { seal, unseal } from "@/lib/seal";
import { refreshSession, TaigaError, type TaigaSession } from "@/lib/taiga";

function issue(session: TaigaSession, clientTail: string) {
  return json({
    access_token: seal("access", { s: session, c: clientTail }, ACCESS_TTL),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: seal("refresh", { s: session, c: clientTail }, REFRESH_TTL),
    scope: "taiga",
  });
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  let p: Record<string, string>;
  if (ct.includes("application/json")) {
    p = await req.json().catch(() => ({}));
  } else {
    p = Object.fromEntries(new URLSearchParams(await req.text()));
  }
  // client_id può arrivare anche via HTTP Basic
  const basic = req.headers.get("authorization");
  if (!p.client_id && basic?.startsWith("Basic ")) {
    p.client_id = decodeURIComponent(Buffer.from(basic.slice(6), "base64").toString().split(":")[0]);
  }
  const clientTail = (p.client_id ?? "").slice(-24);

  if (p.grant_type === "authorization_code") {
    const code = unseal<{ c: string; r: string; ch: string; s: TaigaSession }>("code", p.code);
    if (!code) return oauthError("invalid_grant", "Codice non valido o scaduto");
    if (code.c !== clientTail) return oauthError("invalid_grant", "Codice emesso per un altro client");
    if (p.redirect_uri && p.redirect_uri !== code.r) return oauthError("invalid_grant", "redirect_uri diverso");
    if (!pkceOk(p.code_verifier ?? null, code.ch)) return oauthError("invalid_grant", "code_verifier non valido");
    return issue(code.s, clientTail);
  }

  if (p.grant_type === "refresh_token") {
    const rt = unseal<{ c: string; s: TaigaSession }>("refresh", p.refresh_token);
    if (!rt) return oauthError("invalid_grant", "Refresh token non valido o scaduto");
    if (!p.client_id) return oauthError("invalid_request", "client_id obbligatorio");
    if (rt.c !== clientTail) return oauthError("invalid_grant", "Refresh token emesso per un altro client");
    try {
      const s = await refreshSession(rt.s);
      return issue(s, rt.c);
    } catch (e) {
      if (e instanceof TaigaError && e.status && e.status < 500) return oauthError("invalid_grant", "Sessione Taiga scaduta: ricollega il connettore");
      return oauthError("temporarily_unavailable", "Taiga non raggiungibile", 503);
    }
  }

  return oauthError("unsupported_grant_type", "grant_type non supportato");
}

export const OPTIONS = cors;
