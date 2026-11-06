// Pagina di autorizzazione: l'utente sceglie istanza Taiga e modalità di accesso, poi fa login.
import { authModes, CODE_TTL, type AuthMode } from "@/lib/config";
import { errorPage, loginPage } from "@/lib/html";
import { getClient, redirectAllowed } from "@/lib/oauth";
import { seal } from "@/lib/seal";
import { login } from "@/lib/taiga";

const KEYS = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"] as const;

function validate(p: Record<string, string>) {
  const client = getClient(p.client_id);
  if (!client) return { error: "client_id sconosciuto o scaduto. Riprova a collegare il connettore." };
  if (!p.redirect_uri || !redirectAllowed(client, p.redirect_uri)) return { error: "redirect_uri non registrato per questo client." };
  return { client };
}

function redirectHost(uri: string) {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

function backWithError(redirectUri: string, state: string, error: string, description: string) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return Response.redirect(u.toString(), 302);
}

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const p = Object.fromEntries(KEYS.map((k) => [k, q.get(k) ?? ""])) as Record<string, string>;
  const v = validate(p);
  if (!v.client) return errorPage(v.error!);
  if (q.get("response_type") !== "code") return backWithError(p.redirect_uri, p.state, "unsupported_response_type", "Solo response_type=code");
  if (!p.code_challenge || p.code_challenge_method !== "S256") return backWithError(p.redirect_uri, p.state, "invalid_request", "PKCE S256 obbligatorio");
  return loginPage({ hidden: p, clientName: v.client.n, redirectHost: redirectHost(p.redirect_uri) });
}

export async function POST(req: Request) {
  const f = await req.formData();
  const get = (k: string) => String(f.get(k) ?? "");
  const p = Object.fromEntries(KEYS.map((k) => [k, get(k)])) as Record<string, string>;
  const v = validate(p);
  if (!v.client) return errorPage(v.error!);
  if (!p.code_challenge || p.code_challenge_method !== "S256") return errorPage("PKCE S256 obbligatorio");

  const mode = get("mode") as AuthMode;
  const values = { instance: get("instance"), mode, username: get("username") };
  if (!authModes().includes(mode)) {
    return loginPage({ hidden: p, clientName: v.client.n, redirectHost: redirectHost(p.redirect_uri), error: "Modalità di accesso non disponibile", values });
  }
  try {
    const session = await login(get("instance"), mode, get("username").trim(), mode === "token" ? get("token").trim() : get("password"));
    const code = seal(
      "code",
      { c: p.client_id.slice(-24), r: p.redirect_uri, ch: p.code_challenge, s: session },
      CODE_TTL,
    );
    const u = new URL(p.redirect_uri);
    u.searchParams.set("code", code);
    if (p.state) u.searchParams.set("state", p.state);
    return Response.redirect(u.toString(), 303);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return loginPage({ hidden: p, clientName: v.client.n, redirectHost: redirectHost(p.redirect_uri), error: msg, values });
  }
}
