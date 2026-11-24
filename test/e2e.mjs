import { createHash, randomBytes } from "node:crypto";
const B = "http://localhost:3000";
const log = (...a) => console.log(...a);
const must = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } else log("ok  -", m); };

// 1. 401 + discovery
let r = await fetch(`${B}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
const www = r.headers.get("www-authenticate");
must(r.status === 401 && /resource_metadata=/.test(www), `401 con WWW-Authenticate (${www})`);
const prm = await (await fetch(`${B}/.well-known/oauth-protected-resource/mcp`)).json();
must(prm.resource === `${B}/mcp` && prm.authorization_servers[0] === B, "protected resource metadata");
const asm = await (await fetch(`${B}/.well-known/oauth-authorization-server`)).json();
must(asm.registration_endpoint && asm.code_challenge_methods_supported.includes("S256"), "authorization server metadata");

// 2. DCR
const cb = "https://claude.ai/api/mcp/auth_callback";
const reg = await (await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [cb] }) })).json();
must(reg.client_id?.startsWith("tg_client_"), "registrazione client");
let rr = await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://evil.example/cb"] }) });
must(rr.status === 400 && (await rr.json()).error === "invalid_redirect_uri", "registrazione con redirect_uri su host non ammesso rifiutata");
rr = await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [cb, "https://evil.example/cb"] }) });
must(rr.status === 400, "registrazione mista (host ammesso + non ammesso) rifiutata");
rr = await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:53412/callback", "http://127.0.0.1/cb"] }) });
must(rr.status === 201, "registrazione con redirect loopback ancora ammessa");

// 3. authorize
const verifier = randomBytes(40).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: cb, state: "xyz", code_challenge: challenge, code_challenge_method: "S256", scope: "taiga" });
r = await fetch(`${B}/authorize?${q}`);
const html = await r.text();
must(r.status === 200 && html.includes("Collega Taiga") && html.includes("claude.ai"), "pagina di login");
must(!(await fetch(`${B}/authorize?${new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: "https://evil.example/cb" })}`).then((x) => x.text())).includes("<form"), "redirect_uri estraneo rifiutato");

const form = (extra) => new URLSearchParams({ ...Object.fromEntries(q), instance: "http://127.0.0.1:8765", mode: "password", username: "raffaele", ...extra });
r = await fetch(`${B}/authorize`, { method: "POST", body: form({ password: "sbagliata" }), redirect: "manual" });
const errHtml = await r.text();
must(r.status === 200 && errHtml.includes("incorrect"), "password errata mostra errore");
r = await fetch(`${B}/authorize`, { method: "POST", body: form({ password: "segreta" }), redirect: "manual" });
const loc = new URL(r.headers.get("location"));
must(r.status === 303 && loc.origin + loc.pathname === cb && loc.searchParams.get("state") === "xyz", "redirect con code e state");
const code = loc.searchParams.get("code");

// 4. token
const tok = (body) => fetch(asm.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }).then(async (x) => ({ status: x.status, j: await x.json() }));
let t = await tok({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: cb, code_verifier: "x".repeat(50) });
must(t.status === 400 && t.j.error === "invalid_grant", "PKCE errato rifiutato");
t = await tok({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: cb, code_verifier: verifier });
must(t.status === 200 && t.j.access_token && t.j.refresh_token, "scambio codice → token");
let access = t.j.access_token;
must(!t.j.access_token.includes("segreta") && !Buffer.from(t.j.access_token.slice(10), "base64url").toString("latin1").includes("tok"), "token cifrato (nessun dato in chiaro)");

// 5. MCP
let id = 0;
async function rpc(method, params, notify = false) {
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
  const res = await fetch(`${B}/mcp`, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify(body) });
  const txt = await res.text();
  if (notify) return res.status;
  const line = txt.split("\n").find((l) => l.startsWith("data:"));
  const j = JSON.parse(line ? line.slice(5) : txt);
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
const call = async (name, args) => {
  const res = await rpc("tools/call", { name, arguments: args });
  const text = res.content[0].text;
  return { err: !!res.isError, text, j: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
must(init.serverInfo.name === "taiga-mcp", `initialize (protocol ${init.protocolVersion})`);
await rpc("notifications/initialized", {}, true);
const tools = await rpc("tools/list", {});
must(tools.tools.length >= 15, `tools/list: ${tools.tools.map((x) => x.name).join(", ")}`);
const del = tools.tools.find((x) => x.name === "taiga_delete_item");
must(del.annotations?.destructiveHint === true, "delete marcato come distruttivo");

let c = await call("taiga_whoami", {});
must(c.j?.username === "raffaele", "whoami");
c = await call("taiga_get_project", { project: "growth" });
must(c.j?.us_statuses?.includes("Done") && c.j.sprints.length === 1, "get_project");
c = await call("taiga_get_item", { kind: "us", project: "growth", ref: "#42" });
must(c.j?.subject === "Login SSO", "get_item via #ref");
c = await call("taiga_update_item", { kind: "us", project: "growth", ref: 42, status: "in progress", assigned_to: "Daniele", sprint: "Sprint 12", tags: ["growth"], comment: "preso in carico" });
must(c.j?.updated?.status === "In progress" && c.j.updated.assigned_to === "Daniele Pompa" && c.j.url.endsWith("/project/growth/us/42"), "update_item (stato, utente parziale, sprint, commento)");
c = await call("taiga_create_item", { kind: "task", project: "growth", subject: "Configurare provider", user_story: "#42", assigned_to: "me" });
must(c.j?.created?.assigned_to === "Raffaele Colace", "create_item task");
c = await call("taiga_bulk_create", { kind: "task", project: "growth", user_story: 42, subjects: ["A", "B"] });
must(Array.isArray(c.j) && c.j.length === 2, "bulk_create task");
c = await call("taiga_list_items", { kind: "task", project: "growth", user_story: "#42", only_open: true });
must(c.j?.total === 3, "list_items task di una US");
c = await call("taiga_update_item", { kind: "us", project: "growth", ref: 42, status: "Chiuso" });
must(c.err && c.text.includes("Disponibili: New, In progress, Done"), "stato inesistente → errore leggibile");
c = await call("taiga_delete_item", { kind: "us", project: "growth", ref: 42 });
must(c.err, "delete senza confirm rifiutato");
c = await call("taiga_api", { method: "GET", path: "/api/v1/users/me" });
must(c.j?.id === 5, "taiga_api passthrough");
c = await call("taiga_api", { method: "GET", path: "http://evil/x" });
must(c.err, "taiga_api rifiuta URL assoluti");
for (const bad of ["http\t://127.0.0.1:8765/api/v1/users/me", "https\n://evil.example/x", "%2e%2e/%2e%2e/admin", ".%2E/admin", "..%2f..%2fadmin", "%2e%2e%2fadmin", "%252e%252e/admin", "users%5c..%5cadmin", "..\\admin", "users\\me", "//evil.example/x", "/api/v1//evil.example/x", "../admin"]) {
  c = await call("taiga_api", { method: "GET", path: bad });
  must(c.err && c.text.includes("Path non valido"), `taiga_api rifiuta ${JSON.stringify(bad)}`);
}
c = await call("taiga_api", { method: "GET", path: "users/me?q=a b..c" });
must(c.j?.id === 5, "taiga_api: testo libero nella query ammesso");
c = await call("taiga_api", { method: "GET", path: "users/me" });
must(c.j?.id === 5, "taiga_api con path relativo semplice funziona ancora");

c = await call("taiga_update_item", { kind: "task", project: "growth", ref: 61, status: "Done" });
c = await call("taiga_list_items", { kind: "task", project: "growth", closed_since: "2026-11-01" });
must(c.j?.total === 1 && c.j.items[0].closed_on === "2026-11-05" && c.j.items[0].url.includes("/task/"), "list_items closed_since + date + url");
c = await call("taiga_list_items", { kind: "task", project: "growth", closed_since: "2026-12-01" });
must(c.j?.total === 0, "closed_since futuro → nessun risultato");
c = await call("taiga_list_items", { kind: "task", project: "growth", closed_since: "05/11/2026" });
must(c.err, "formato data non valido rifiutato");

// 6. refresh
let noClient = await tok({ grant_type: "refresh_token", refresh_token: t.j.refresh_token });
must(noClient.status === 400 && noClient.j.error === "invalid_request", "refresh senza client_id rifiutato");
noClient = await tok({ grant_type: "refresh_token", refresh_token: t.j.refresh_token, client_id: "tg_client_" + "x".repeat(40) });
must(noClient.status === 400 && noClient.j.error === "invalid_grant", "refresh con client_id di un altro client rifiutato");
t = await tok({ grant_type: "refresh_token", refresh_token: t.j.refresh_token, client_id: reg.client_id });
must(t.status === 200 && t.j.access_token, "refresh token (sessione Taiga rinnovata)");
access = t.j.access_token;
c = await call("taiga_whoami", {});
must(c.j?.username === "raffaele", "MCP con token rinnovato");
t = await tok({ grant_type: "refresh_token", refresh_token: "tg_refresh_garbage" });
must(t.status === 400 && t.j.error === "invalid_grant", "refresh non valido → invalid_grant");

// 7. modalità token
r = await fetch(`${B}/authorize`, { method: "POST", body: form({ mode: "token", token: "tok999" }), redirect: "manual" });
must(r.status === 200 && (await r.text()).includes("err"), "token non valido rifiutato");

// 8. protezione SSRF (seconda istanza, senza ALLOW_INSECURE_URLS)
const S = "http://localhost:3001";
for (const instance of ["https://[::ffff:127.0.0.1]", "https://[::]", "https://[::1]", "https://[::ffff:169.254.169.254]", "https://[64:ff9b::7f00:1]", "https://[::ffff:0:127.0.0.1]", "https://localhost.", "https://127.0.0.1", "https://10.0.0.5", "https://100.64.0.1", "https://169.254.169.254", "https://localtest.me", "https://x.127.0.0.1.nip.io"]) {
  r = await fetch(`${S}/authorize`, { method: "POST", body: form({ instance, password: "segreta" }), redirect: "manual" });
  must(r.status === 200 && (await r.text()).includes("rete privata"), `SSRF: ${instance} rifiutato`);
}
r = await fetch(`${S}/authorize`, { method: "POST", body: form({ password: "segreta" }), redirect: "manual" });
must(r.status === 200 && (await r.text()).includes("Serve un indirizzo https"), "SSRF: http:// rifiutato senza ALLOW_INSECURE_URLS");
log("\nTUTTI I TEST PASSATI");

// 9. icone
must(init.serverInfo.icons?.[0]?.src?.startsWith("data:image/svg+xml"), "serverInfo.icons presente");
for (const p of ["/favicon.ico", "/icon.svg", "/apple-icon.png"]) {
  const x = await fetch(B + p);
  must(x.status === 200, `${p} servito (${x.headers.get("content-type")})`);
}
must((await (await fetch(B + "/")).text()).includes('rel="icon"'), "link icon nella home");
log("ICONE OK");
