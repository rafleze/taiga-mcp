// Client minimale per l'API REST di Taiga v1 (self-hosted o taiga.io).
import { allowInsecure, lockedUrl, type AuthMode } from "./config";
import { isPrivateHost, resolvesToPublic } from "./net";

export class TaigaError extends Error {
  constructor(message: string, public status?: number, public detail?: unknown) {
    super(message);
  }
}

export type Kind = "us" | "task" | "issue" | "epic";

export const ENTITIES: Record<Kind, { path: string; statuses: string; history: string; web: string }> = {
  us: { path: "userstories", statuses: "userstory-statuses", history: "userstory", web: "us" },
  task: { path: "tasks", statuses: "task-statuses", history: "task", web: "task" },
  issue: { path: "issues", statuses: "issue-statuses", history: "issue", web: "issue" },
  epic: { path: "epics", statuses: "epic-statuses", history: "epic", web: "epic" },
};

/**
 * Normalizza l'URL che l'utente incolla (indirizzo web o API) e restituisce
 * { api: base API, web: base del sito }.
 * - https://taiga.miaazienda.it            -> api https://taiga.miaazienda.it/api/v1
 * - https://taiga.miaazienda.it/api/v1/    -> idem
 * - https://tree.taiga.io (o taiga.io)     -> api https://api.taiga.io/api/v1
 */
export function normalizeInstance(input: string): { api: string; web: string } {
  let raw = (input || "").trim();
  if (!raw) throw new TaigaError("Indica l'URL della tua istanza Taiga");
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new TaigaError("URL non valido");
  }
  if (u.username || u.password) throw new TaigaError("L'URL non può contenere credenziali");
  const host = u.hostname.toLowerCase();
  if (host === "taiga.io" || host.endsWith(".taiga.io")) {
    return { api: "https://api.taiga.io/api/v1", web: "https://tree.taiga.io" };
  }
  if (!allowInsecure()) {
    if (u.protocol !== "https:") throw new TaigaError("Serve un indirizzo https://");
    if (isPrivateHost(host)) throw new TaigaError(PRIVATE_MSG);
  }
  let path = u.pathname.replace(/\/+$/, "");
  path = path.replace(/\/api\/v1$/, "");
  // se l'utente incolla un link a una pagina (es. /project/xyz), tieni solo la radice
  path = path.replace(/\/(project|discover|login|profile)(\/.*)?$/, "");
  const web = `${u.protocol}//${u.host}${path}`;
  return { api: `${web}/api/v1`, web };
}

export function checkLocked(api: string) {
  const locked = lockedUrl();
  if (locked && normalizeInstance(locked).api !== api) {
    throw new TaigaError("Questo server è configurato per un'unica istanza Taiga");
  }
}

const PRIVATE_MSG = "Indirizzi locali o di rete privata non sono raggiungibili da questo server";

async function call(api: string, method: string, path: string, opts: { token?: string; body?: unknown; params?: Record<string, unknown> } = {}) {
  // The path is always relative to the instance API: never let it become another URL
  const base = new URL(`${api}/`);
  let target: URL;
  try {
    target = new URL(`${api}/${path.replace(/^\/+/, "")}`);
  } catch {
    throw new TaigaError("Path non valido");
  }
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw new TaigaError("Path non valido");
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v === undefined || v === null || v === "") continue;
      target.searchParams.append(k, String(v));
    }
  }
  // SSRF: the host must resolve only to public addresses, checked before every request
  if (!allowInsecure() && !(await resolvesToPublic(target.hostname))) throw new TaigaError(PRIVATE_MSG);
  const url = target.toString();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-disable-pagination": "1",
    "Accept-Language": "it",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new TaigaError(`Impossibile raggiungere Taiga (${(e as Error).message})`);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text.slice(0, 300);
    }
  }
  if (!res.ok) {
    const d = data as Record<string, unknown> | null;
    const msg = (d && (d._error_message || d.detail)) as string | undefined;
    throw new TaigaError(msg ? `Taiga: ${msg}` : `Taiga ha risposto HTTP ${res.status} su ${method} ${path}`, res.status, data);
  }
  return data;
}

// ------------------------------------------------------------------ login

export type TaigaSession = { api: string; web: string; token: string; refresh?: string; mode: AuthMode; user?: string };

export async function login(instance: string, mode: AuthMode, username: string, secret: string): Promise<TaigaSession> {
  const { api, web } = normalizeInstance(instance);
  checkLocked(api);
  if (mode === "token") {
    if (!secret) throw new TaigaError("Incolla il token");
    const me = (await call(api, "GET", "users/me", { token: secret.replace(/^Bearer\s+/i, "") })) as Record<string, unknown>;
    return { api, web, token: secret.replace(/^Bearer\s+/i, ""), mode, user: String(me.username) };
  }
  if (!username || !secret) throw new TaigaError("Inserisci username e password");
  const res = (await call(api, "POST", "auth", {
    body: { type: mode === "ldap" ? "ldap" : "normal", username, password: secret },
  })) as Record<string, unknown>;
  if (!res?.auth_token) throw new TaigaError("Login non riuscito");
  return { api, web, token: String(res.auth_token), refresh: res.refresh ? String(res.refresh) : undefined, mode, user: String(res.username ?? username) };
}

export async function refreshSession(s: TaigaSession): Promise<TaigaSession> {
  if (!s.refresh) return s; // token incollato: non rinnovabile, resta valido finché Taiga lo accetta
  const res = (await call(s.api, "POST", "auth/refresh", { body: { refresh: s.refresh } })) as Record<string, unknown>;
  return { ...s, token: String(res.auth_token), refresh: res.refresh ? String(res.refresh) : s.refresh };
}

// ------------------------------------------------------------------ client autenticato

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class Taiga {
  private cache = new Map<string, unknown>();
  constructor(public s: TaigaSession) {}

  req(method: string, path: string, body?: unknown, params?: Record<string, unknown>) {
    return call(this.s.api, method, path, { token: this.s.token, body, params }) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, await fn());
    return this.cache.get(key) as T;
  }

  me(): Promise<Obj> {
    return this.cached("me", () => this.req("GET", "users/me"));
  }

  project(ref: string | number): Promise<Obj> {
    const r = String(ref).trim();
    return this.cached(`p:${r}`, () => (/^\d+$/.test(r) ? this.req("GET", `projects/${r}`) : this.req("GET", "projects/by_slug", undefined, { slug: r })));
  }

  async projectId(ref: string | number): Promise<number> {
    return /^\d+$/.test(String(ref).trim()) ? Number(ref) : (await this.project(ref)).id;
  }

  /** ref: numero visibile in Taiga (#42) all'interno del progetto */
  async item(kind: Kind, project: string | number, ref: string | number): Promise<Obj> {
    const pid = await this.projectId(project);
    const r = String(ref).replace(/^#/, "").trim();
    return this.req("GET", `${ENTITIES[kind].path}/by_ref`, undefined, { ref: r, project: pid });
  }

  async statusId(kind: Kind, pid: number, value: string | number): Promise<number> {
    if (/^\d+$/.test(String(value))) return Number(value);
    const list: Obj[] = await this.cached(`st:${kind}:${pid}`, () => this.req("GET", ENTITIES[kind].statuses, undefined, { project: pid }));
    const v = String(value).trim().toLowerCase();
    const hit = list.find((s) => s.name.toLowerCase() === v || String(s.slug).toLowerCase() === v);
    if (!hit) throw new TaigaError(`Stato "${value}" non trovato. Disponibili: ${list.map((s) => s.name).join(", ")}`);
    return hit.id;
  }

  async userId(pid: number, value: string | number | null): Promise<number | null> {
    if (value === null) return null;
    const v = String(value).trim();
    if (["", "none", "nessuno"].includes(v.toLowerCase())) return null;
    if (/^\d+$/.test(v)) return Number(v);
    if (v.toLowerCase() === "me") return (await this.me()).id;
    const members: Obj[] = await this.cached(`m:${pid}`, () => this.req("GET", "memberships", undefined, { project: pid }));
    const l = v.toLowerCase();
    const exact = members.find((m) => [m.username, m.user_email, m.full_name].filter(Boolean).some((x: string) => String(x).toLowerCase() === l));
    if (exact) return exact.user;
    const partial = members.filter((m) => String(m.full_name ?? "").toLowerCase().includes(l));
    if (partial.length === 1) return partial[0].user;
    throw new TaigaError(`Utente "${value}" non trovato o ambiguo. Membri: ${members.map((m) => `${m.full_name} (${m.username})`).join(", ")}`);
  }

  async sprintId(pid: number, value: string | number | null): Promise<number | null> {
    if (value === null) return null;
    const v = String(value).trim();
    if (["", "none", "backlog"].includes(v.toLowerCase())) return null;
    if (/^\d+$/.test(v)) return Number(v);
    const sprints: Obj[] = await this.cached(`ms:${pid}`, () => this.req("GET", "milestones", undefined, { project: pid }));
    const hit = sprints.find((s) => s.name.toLowerCase() === v.toLowerCase() || s.slug === v);
    if (!hit) throw new TaigaError(`Sprint "${value}" non trovato. Sprint: ${sprints.map((s) => s.name).join(", ")}`);
    return hit.id;
  }

  /** PATCH con gestione automatica del campo version (concorrenza ottimistica di Taiga) */
  async patch(kind: Kind, obj: Obj, changes: Obj): Promise<Obj> {
    const path = `${ENTITIES[kind].path}/${obj.id}`;
    try {
      return await this.req("PATCH", path, { ...changes, version: obj.version });
    } catch (e) {
      if (e instanceof TaigaError && e.status === 400 && JSON.stringify(e.detail ?? "").toLowerCase().includes("version")) {
        const fresh = await this.req("GET", path);
        return this.req("PATCH", path, { ...changes, version: fresh.version });
      }
      throw e;
    }
  }

  link(kind: Kind, projectSlug: string, ref: number) {
    return `${this.s.web}/project/${projectSlug}/${ENTITIES[kind].web}/${ref}`;
  }
}

export function summarize(o: Obj): Obj {
  const out: Obj = { ref: o.ref, id: o.id, subject: o.subject };
  if (o.status_extra_info) out.status = o.status_extra_info.name;
  if (o.assigned_to_extra_info) out.assigned_to = o.assigned_to_extra_info.full_name_display ?? o.assigned_to_extra_info.username;
  if (o.milestone_name || o.milestone) out.sprint = o.milestone_name ?? o.milestone;
  if (o.user_story_extra_info) out.user_story = `#${o.user_story_extra_info.ref} ${o.user_story_extra_info.subject}`;
  if (o.tags?.length) out.tags = o.tags.map((t: unknown) => (Array.isArray(t) ? t[0] : t));
  if (o.total_points) out.points = o.total_points;
  if (o.is_blocked) out.blocked = o.blocked_note || true;
  if (o.due_date) out.due_date = o.due_date;
  if (o.is_closed !== undefined) out.closed = o.is_closed;
  if (Array.isArray(o.epics) && o.epics.length) out.epics = o.epics.map((e: Obj) => `#${e.ref} ${e.subject}`);
  const day = (d: unknown) => (typeof d === "string" ? d.slice(0, 10) : undefined);
  if (o.created_date) out.created_on = day(o.created_date);
  if (o.modified_date) out.modified_on = day(o.modified_date);
  if (o.finish_date || o.finished_date) out.closed_on = day(o.finish_date ?? o.finished_date);
  return out;
}
