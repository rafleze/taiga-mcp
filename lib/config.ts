// Configurazione del server, tutta da variabili d'ambiente.
//
// TOKEN_SECRET        obbligatoria: stringa casuale (>= 32 caratteri) per cifrare i token
// PUBLIC_URL          opzionale: URL pubblico del server (es. https://taiga-mcp.vercel.app).
//                     Se assente viene ricavato dalla richiesta.
// TAIGA_DEFAULT_URL   opzionale: istanza proposta nel form di login (es. https://taiga.20tab.com)
// TAIGA_LOCKED_URL    opzionale: se impostata, il server funziona SOLO con questa istanza
//                     e il campo URL non è modificabile (deploy aziendale)
// TAIGA_AUTH_MODES    opzionale: modalità di accesso offerte, separate da virgola,
//                     tra: password, ldap, token  (default: password,token)
// ALLOW_INSECURE_URLS opzionale: "1" per accettare istanze http:// o su reti private (solo test)

export type AuthMode = "password" | "ldap" | "token";

export const ACCESS_TTL = 60 * 60; // 1 ora
export const REFRESH_TTL = 60 * 60 * 24 * 90; // 90 giorni
export const CODE_TTL = 120; // 2 minuti

export function publicOrigin(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

export function authModes(): AuthMode[] {
  const raw = process.env.TAIGA_AUTH_MODES ?? "password,token";
  const valid: AuthMode[] = ["password", "ldap", "token"];
  const modes = raw.split(",").map((s) => s.trim().toLowerCase()).filter((m): m is AuthMode => valid.includes(m as AuthMode));
  return modes.length ? modes : ["password", "token"];
}

export const lockedUrl = () => process.env.TAIGA_LOCKED_URL?.trim() || undefined;
export const defaultUrl = () => lockedUrl() ?? (process.env.TAIGA_DEFAULT_URL?.trim() || "");
export const allowInsecure = () => process.env.ALLOW_INSECURE_URLS === "1";
