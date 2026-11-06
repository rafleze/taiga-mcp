// Pagine HTML del server (login e home), senza framework.
import { authModes, defaultUrl, lockedUrl, type AuthMode } from "./config";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
:root{--bg:#f6f5f2;--card:#fff;--fg:#1d1d1b;--mut:#6b6a66;--line:#e2e0da;--acc:#2f7a5b;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1f1e1c;--fg:#f0eee9;--mut:#a5a39d;--line:#34332f;--acc:#5fbf93;--err:#f2b8b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:460px;margin:0 auto;padding:40px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:1.35rem;margin:0 0 4px}p{margin:0 0 16px;color:var(--mut)}
label{display:block;font-weight:600;font-size:.9rem;margin:16px 0 6px}
input,select{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);font:inherit}
input:focus,select:focus{outline:2px solid var(--acc);outline-offset:1px}
input[readonly]{opacity:.7}
button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:9px;background:var(--acc);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{background:color-mix(in srgb,var(--err) 12%,transparent);color:var(--err);padding:10px 12px;border-radius:9px;margin:12px 0}
.hint{font-size:.83rem;color:var(--mut);margin-top:6px}
.who{font-size:.85rem;color:var(--mut);border-top:1px solid var(--line);margin-top:22px;padding-top:14px}
code{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 6px;font-size:.9em;word-break:break-all}
[hidden]{display:none!important}`;

function page(title: string, body: string) {
  return new Response(
    `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-icon.png"><style>${STYLE}</style></head><body><main>${body}</main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

const MODE_LABEL: Record<AuthMode, string> = {
  password: "Username e password Taiga",
  ldap: "Username e password LDAP / aziendali",
  token: "Token di accesso",
};

export function loginPage(o: {
  hidden: Record<string, string>;
  clientName?: string;
  redirectHost: string;
  error?: string;
  values?: { instance?: string; mode?: string; username?: string };
}) {
  const modes = authModes();
  const locked = lockedUrl();
  const instance = locked ?? o.values?.instance ?? defaultUrl();
  const mode = (o.values?.mode as AuthMode) ?? modes[0];
  const hidden = Object.entries(o.hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  const body = `<div class="card">
<h1>Collega Taiga</h1>
<p>${esc(o.clientName || "Claude")} chiede di accedere a Taiga con il tuo account.</p>
${o.error ? `<div class="err" role="alert">${esc(o.error)}</div>` : ""}
<form method="post" action="/authorize" autocomplete="on">
${hidden}
<label for="instance">Indirizzo dell'istanza Taiga</label>
<input id="instance" name="instance" type="url" required value="${esc(instance)}" placeholder="https://taiga.miaazienda.it" ${locked ? "readonly" : ""}>
<div class="hint">${locked ? "Questo server è configurato per un'unica istanza." : "L'indirizzo che apri nel browser. Per Taiga cloud usa <code>https://tree.taiga.io</code>."}</div>
${
  modes.length > 1
    ? `<label for="mode">Modalità di accesso</label><select id="mode" name="mode">${modes
        .map((m) => `<option value="${m}" ${m === mode ? "selected" : ""}>${MODE_LABEL[m]}</option>`)
        .join("")}</select>`
    : `<input type="hidden" id="mode" name="mode" value="${modes[0]}">`
}
<div id="cred">
<label for="username">Username o email</label>
<input id="username" name="username" autocomplete="username" value="${esc(o.values?.username ?? "")}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password">
<div class="hint">La password serve solo per ottenere una sessione da Taiga: non viene salvata.</div>
</div>
<div id="tok" hidden>
<label for="token">Token</label>
<input id="token" name="token" type="password" autocomplete="off">
<div class="hint">Utile se accedi con Google/GitHub o SSO. Da Taiga nel browser: strumenti per sviluppatori → Console → <code>localStorage.token</code>, copia il valore senza virgolette.</div>
</div>
<button type="submit">Accedi e autorizza</button>
</form>
<div class="who">Dopo l'accesso tornerai su <strong>${esc(o.redirectHost)}</strong>.</div>
</div>
<script>
const m=document.getElementById('mode');function s(){const t=m.value==='token';document.getElementById('tok').hidden=!t;document.getElementById('cred').hidden=t;}
m.addEventListener('change',s);s();
</script>`;
  return page("Collega Taiga", body);
}

export function homePage(origin: string) {
  const body = `<div class="card">
<h1>Taiga MCP</h1>
<p>Server MCP per collegare Claude a Taiga (self-hosted o taiga.io).</p>
<label>URL da usare nel connettore</label>
<code>${esc(origin)}/mcp</code>
<div class="hint">In Claude: Impostazioni → Connettori → Aggiungi connettore personalizzato, incolla l'URL e accedi con le tue credenziali Taiga.</div>
</div>`;
  return page("Taiga MCP", body);
}

export function errorPage(msg: string) {
  return page("Errore", `<div class="card"><h1>Richiesta non valida</h1><div class="err">${esc(msg)}</div></div>`);
}
