// Tool MCP esposti a Claude.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ENTITIES, Taiga, TaigaError, summarize, type Kind, type TaigaSession } from "./taiga";

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const kind = z.enum(["us", "task", "issue", "epic"]).describe("us = user story, task, issue, epic");
const project = z.union([z.string(), z.number()]).describe("Slug del progetto (es. 'growth') o id numerico");
const ref = z.union([z.string(), z.number()]).describe("Riferimento visibile in Taiga, es. 42 o '#42'");

const editFields = {
  subject: z.string().optional().describe("Titolo"),
  description: z.string().optional().describe("Descrizione in Markdown"),
  status: z.string().optional().describe("Nome dello stato (es. 'In progress') o id"),
  assigned_to: z.string().nullable().optional().describe("username, email, nome completo, 'me', oppure null/'none' per rimuovere"),
  sprint: z.string().nullable().optional().describe("Nome sprint o id; 'backlog' o null per toglierlo dallo sprint (us/task/issue)"),
  tags: z.array(z.string()).optional().describe("Sostituisce l'elenco dei tag"),
  due_date: z.string().nullable().optional().describe("YYYY-MM-DD, null per rimuovere"),
  user_story: ref.optional().describe("(solo task) user story di appartenenza"),
  blocked: z.boolean().optional(),
  blocked_note: z.string().optional(),
  comment: z.string().optional().describe("Commento da aggiungere insieme alla modifica"),
  extra: z.record(z.string(), z.unknown()).optional().describe("Altri campi dell'API Taiga da impostare così come sono (es. client_requirement, severity, priority, type, points)"),
};

const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

function sessionFrom(ctx: unknown): TaigaSession {
  const c = ctx as Obj;
  const s = c?.http?.authInfo?.extra?.session ?? c?.authInfo?.extra?.session;
  if (!s) throw new TaigaError("Sessione Taiga assente: ricollega il connettore");
  return s as TaigaSession;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown) {
  let msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TaigaError && e.status === 401) msg += " — la sessione Taiga è scaduta: disconnetti e ricollega il connettore.";
  if (e instanceof TaigaError && e.status === 403) msg += " — l'utente non ha i permessi per questa operazione su Taiga.";
  return { isError: true, content: [{ type: "text" as const, text: msg }] };
}

function tool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: S,
  annotations: Obj,
  run: (t: Taiga, a: z.infer<z.ZodObject<S>>) => Promise<unknown>,
) {
  server.registerTool(
    name,
    { description, inputSchema: z.object(shape), annotations },
    (async (args: z.infer<z.ZodObject<S>>, ctx: unknown) => {
      try {
        return ok(await run(new Taiga(sessionFrom(ctx)), args));
      } catch (e) {
        return fail(e);
      }
    }) as never,
  );
}

async function buildChanges(t: Taiga, k: Kind, pid: number, a: Obj): Promise<Obj> {
  const ch: Obj = {};
  if (a.subject !== undefined) ch.subject = a.subject;
  if (a.description !== undefined) ch.description = a.description;
  if (a.status !== undefined) ch.status = await t.statusId(k, pid, a.status);
  if (a.assigned_to !== undefined) ch.assigned_to = await t.userId(pid, a.assigned_to);
  if (a.sprint !== undefined && k !== "epic") ch.milestone = await t.sprintId(pid, a.sprint);
  if (a.tags !== undefined) ch.tags = a.tags;
  if (a.due_date !== undefined) ch.due_date = a.due_date || null;
  if (a.user_story !== undefined && k === "task") ch.user_story = (await t.item("us", pid, a.user_story)).id;
  if (a.blocked !== undefined) ch.is_blocked = a.blocked;
  if (a.blocked_note !== undefined) ch.blocked_note = a.blocked_note;
  if (a.extra) Object.assign(ch, a.extra);
  return ch;
}

export function registerTools(server: McpServer) {
  tool(server, "taiga_whoami", "Utente Taiga collegato e istanza in uso.", {}, READ, async (t) => {
    const me = await t.me();
    return { instance: t.s.web, id: me.id, username: me.username, full_name: me.full_name, email: me.email };
  });

  tool(server, "taiga_list_projects", "Progetti di cui l'utente è membro, con slug e id.", {}, READ, async (t) => {
    const me = await t.me();
    const ps: Obj[] = await t.req("GET", "projects", undefined, { member: me.id });
    return ps.map((p) => ({ id: p.id, slug: p.slug, name: p.name, backlog: p.is_backlog_activated, kanban: p.is_kanban_activated }));
  });

  tool(
    server,
    "taiga_get_project",
    "Dettaglio di un progetto: stati disponibili per ogni tipo, membri, sprint. Chiamalo prima di creare o modificare elementi in un progetto che non conosci.",
    { project },
    READ,
    async (t, a) => {
      const p = await t.project(a.project);
      const sprints: Obj[] = await t.req("GET", "milestones", undefined, { project: p.id });
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        url: `${t.s.web}/project/${p.slug}`,
        us_statuses: p.us_statuses?.map((s: Obj) => s.name),
        task_statuses: p.task_statuses?.map((s: Obj) => s.name),
        issue_statuses: p.issue_statuses?.map((s: Obj) => s.name),
        epic_statuses: p.epic_statuses?.map((s: Obj) => s.name),
        issue_types: p.issue_types?.map((s: Obj) => s.name),
        priorities: p.priorities?.map((s: Obj) => s.name),
        severities: p.severities?.map((s: Obj) => s.name),
        members: p.members?.map((m: Obj) => ({ id: m.id, name: m.full_name_display ?? m.full_name, username: m.username, role: m.role_name })),
        sprints: sprints.map((s) => ({ id: s.id, name: s.name, start: s.estimated_start, end: s.estimated_finish, closed: s.closed })),
      };
    },
  );

  tool(
    server,
    "taiga_list_items",
    "Elenca user story, task, issue o epic di un progetto con filtri opzionali.",
    {
      kind,
      project,
      status: z.string().optional(),
      assigned_to: z.string().optional().describe("username, nome o 'me'"),
      sprint: z.string().optional().describe("nome sprint, id o 'backlog'"),
      tags: z.array(z.string()).optional(),
      user_story: ref.optional().describe("(solo task) task di questa user story"),
      text: z.string().optional().describe("filtra per testo nel titolo"),
      only_open: z.boolean().optional().describe("esclude gli elementi chiusi"),
      closed_since: z.string().optional().describe("YYYY-MM-DD: solo elementi chiusi da questa data in poi (data di chiusura)"),
      closed_before: z.string().optional().describe("YYYY-MM-DD: solo elementi chiusi entro questa data"),
      modified_since: z.string().optional().describe("YYYY-MM-DD: solo elementi modificati da questa data"),
      created_since: z.string().optional().describe("YYYY-MM-DD: solo elementi creati da questa data"),
      limit: z.number().int().positive().max(500).optional().describe("default 100"),
    },
    READ,
    async (t, a) => {
      const pid = await t.projectId(a.project);
      const params: Obj = { project: pid };
      const date = (v: string | undefined, name: string) => {
        if (v === undefined) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new TaigaError(`${name} deve essere nel formato YYYY-MM-DD`);
        return v;
      };
      // le task usano finished_date, le altre entità finish_date
      const fin = a.kind === "task" ? "finished_date" : "finish_date";
      if (a.closed_since) params[`${fin}__gte`] = date(a.closed_since, "closed_since");
      if (a.closed_before) params[`${fin}__lte`] = `${date(a.closed_before, "closed_before")}T23:59:59`;
      if (a.modified_since) params.modified_date__gte = date(a.modified_since, "modified_since");
      if (a.created_since) params.created_date__gte = date(a.created_since, "created_since");
      if (a.status) params.status = await t.statusId(a.kind, pid, a.status);
      if (a.assigned_to) params.assigned_to = await t.userId(pid, a.assigned_to);
      if (a.sprint) params.milestone = (await t.sprintId(pid, a.sprint)) ?? "null";
      if (a.tags?.length) params.tags = a.tags.join(",");
      if (a.user_story && a.kind === "task") params.user_story = (await t.item("us", pid, a.user_story)).id;
      if (a.text) params.q = a.text;
      let items: Obj[] = await t.req("GET", ENTITIES[a.kind].path, undefined, params);
      if (a.text) {
        const q = a.text.toLowerCase();
        const f = items.filter((i) => String(i.subject).toLowerCase().includes(q));
        if (f.length) items = f;
      }
      if (a.only_open) items = items.filter((i) => !i.is_closed);
      // filtro lato client di sicurezza, nel caso l'istanza ignori i filtri per data
      const d = (x: unknown) => (typeof x === "string" ? x.slice(0, 10) : "");
      if (a.closed_since) items = items.filter((i) => i.is_closed && d(i.finish_date ?? i.finished_date) >= a.closed_since!);
      if (a.closed_before) items = items.filter((i) => i.is_closed && d(i.finish_date ?? i.finished_date) <= a.closed_before!);
      if (a.modified_since) items = items.filter((i) => d(i.modified_date) >= a.modified_since!);
      if (a.created_since) items = items.filter((i) => d(i.created_date) >= a.created_since!);
      const total = items.length;
      items = items.slice(0, a.limit ?? 100);
      const slug = (await t.project(pid)).slug;
      return { total, shown: items.length, items: items.map((i) => ({ ...summarize(i), url: t.link(a.kind, slug, i.ref) })) };
    },
  );

  tool(
    server,
    "taiga_get_item",
    "Dettaglio completo di un elemento tramite il suo #ref. Per le user story include i task.",
    { kind, project, ref, raw: z.boolean().optional().describe("restituisce il JSON completo dell'API") },
    READ,
    async (t, a) => {
      const o = await t.item(a.kind, a.project, a.ref);
      if (a.raw) return o;
      const p = await t.project(a.project);
      const out: Obj = { ...summarize(o), description: o.description, url: t.link(a.kind, p.slug, o.ref) };
      if (a.kind === "us") {
        const tasks: Obj[] = await t.req("GET", "tasks", undefined, { user_story: o.id });
        out.tasks = tasks.map(summarize);
      }
      if (a.kind === "epic") {
        const rel: Obj[] = await t.req("GET", `epics/${o.id}/related_userstories`);
        out.user_stories = rel.map((r) => r.user_story);
      }
      return out;
    },
  );

  tool(
    server,
    "taiga_create_item",
    "Crea una user story, task, issue o epic. Per un task indica user_story per agganciarlo a una storia.",
    { kind, project, ...editFields, subject: z.string().describe("Titolo") },
    WRITE,
    async (t, a) => {
      const pid = await t.projectId(a.project);
      const body = { project: pid, ...(await buildChanges(t, a.kind, pid, a)) };
      let o: Obj = await t.req("POST", ENTITIES[a.kind].path, body);
      if (a.comment) o = await t.patch(a.kind, o, { comment: a.comment });
      const p = await t.project(pid);
      return { created: summarize(o), url: t.link(a.kind, p.slug, o.ref) };
    },
  );

  tool(
    server,
    "taiga_update_item",
    "Modifica un elemento esistente (stato, assegnatario, sprint, testo, tag, blocco, campi extra). Solo i campi indicati vengono cambiati.",
    { kind, project, ref, ...editFields },
    WRITE,
    async (t, a) => {
      const o = await t.item(a.kind, a.project, a.ref);
      const ch = await buildChanges(t, a.kind, o.project, a);
      if (a.comment) ch.comment = a.comment;
      if (!Object.keys(ch).length) throw new TaigaError("Nessuna modifica indicata");
      const updated = await t.patch(a.kind, o, ch);
      const p = await t.project(o.project);
      return { updated: summarize(updated), url: t.link(a.kind, p.slug, updated.ref) };
    },
  );

  tool(server, "taiga_add_comment", "Aggiunge un commento a un elemento.", { kind, project, ref, text: z.string() }, WRITE, async (t, a) => {
    const o = await t.item(a.kind, a.project, a.ref);
    await t.patch(a.kind, o, { comment: a.text });
    return { ok: true, commented_on: summarize(o) };
  });

  tool(
    server,
    "taiga_get_history",
    "Storico di un elemento: commenti e campi modificati, dal più recente.",
    { kind, project, ref, comments_only: z.boolean().optional() },
    READ,
    async (t, a) => {
      const o = await t.item(a.kind, a.project, a.ref);
      const h: Obj[] = await t.req("GET", `history/${ENTITIES[a.kind].history}/${o.id}`);
      let out = h.map((e) => ({
        date: e.created_at,
        user: e.user?.name,
        comment: e.comment || undefined,
        changed: e.values_diff ? Object.keys(e.values_diff) : undefined,
      }));
      if (a.comments_only) out = out.filter((x) => x.comment);
      return out;
    },
  );

  tool(
    server,
    "taiga_delete_item",
    "Elimina definitivamente un elemento. Usalo SOLO dopo una conferma esplicita dell'utente nella conversazione, riportandogli prima titolo e #ref.",
    { kind, project, ref, confirm: z.literal(true).describe("deve essere true: l'utente ha confermato l'eliminazione") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async (t, a) => {
      const o = await t.item(a.kind, a.project, a.ref);
      await t.req("DELETE", `${ENTITIES[a.kind].path}/${o.id}`);
      return { deleted: summarize(o) };
    },
  );

  tool(
    server,
    "taiga_bulk_create",
    "Crea più user story in un progetto, oppure più task in una user story, a partire da una lista di titoli.",
    {
      kind: z.enum(["us", "task"]),
      project,
      subjects: z.array(z.string()).min(1).max(100),
      user_story: ref.optional().describe("obbligatorio per i task"),
      status: z.string().optional(),
      sprint: z.string().optional().describe("(solo us) sprint in cui inserirle"),
    },
    WRITE,
    async (t, a) => {
      const pid = await t.projectId(a.project);
      const lines = a.subjects.map((s) => s.replace(/\n/g, " ").trim()).filter(Boolean).join("\n");
      if (a.kind === "us") {
        const body: Obj = { project_id: pid, bulk_stories: lines };
        if (a.status) body.status_id = await t.statusId("us", pid, a.status);
        const created: Obj[] = await t.req("POST", "userstories/bulk_create", body);
        if (a.sprint) {
          const mid = await t.sprintId(pid, a.sprint);
          await t.req("POST", "userstories/bulk_update_milestone", {
            project_id: pid,
            milestone_id: mid,
            bulk_stories: created.map((u, i) => ({ us_id: u.id, order: i })),
          });
        }
        return created.map(summarize);
      }
      if (!a.user_story) throw new TaigaError("Per creare task serve user_story");
      const us = await t.item("us", pid, a.user_story);
      const body: Obj = { project_id: pid, us_id: us.id, bulk_tasks: lines };
      if (us.milestone) body.milestone_id = us.milestone;
      if (a.status) body.status_id = await t.statusId("task", pid, a.status);
      const created: Obj[] = await t.req("POST", "tasks/bulk_create", body);
      return created.map(summarize);
    },
  );

  tool(server, "taiga_list_sprints", "Sprint (milestone) di un progetto con avanzamento in punti.", { project, only_open: z.boolean().optional() }, READ, async (t, a) => {
    const pid = await t.projectId(a.project);
    const sps: Obj[] = await t.req("GET", "milestones", undefined, { project: pid, closed: a.only_open ? "false" : undefined });
    return sps.map((s) => ({
      id: s.id,
      name: s.name,
      start: s.estimated_start,
      end: s.estimated_finish,
      closed: s.closed,
      total_points: s.total_points,
      closed_points: s.closed_points,
      user_stories: (s.user_stories ?? []).map((u: Obj) => `#${u.ref} ${u.subject}`),
    }));
  });

  tool(
    server,
    "taiga_create_sprint",
    "Crea uno sprint in un progetto.",
    { project, name: z.string(), start: z.string().describe("YYYY-MM-DD"), end: z.string().describe("YYYY-MM-DD") },
    WRITE,
    async (t, a) => {
      const pid = await t.projectId(a.project);
      const s = await t.req("POST", "milestones", { project: pid, name: a.name, estimated_start: a.start, estimated_finish: a.end });
      return { id: s.id, name: s.name, start: s.estimated_start, end: s.estimated_finish };
    },
  );

  tool(server, "taiga_sprint_stats", "Statistiche e burndown di uno sprint.", { project, sprint: z.string() }, READ, async (t, a) => {
    const pid = await t.projectId(a.project);
    const mid = await t.sprintId(pid, a.sprint);
    if (mid === null) throw new TaigaError("Indica uno sprint");
    return t.req("GET", `milestones/${mid}/stats`);
  });

  tool(server, "taiga_search", "Ricerca full-text in un progetto (user story, task, issue, epic, wiki).", { project, text: z.string() }, READ, async (t, a) => {
    const pid = await t.projectId(a.project);
    const r: Obj = await t.req("GET", "search", undefined, { project: pid, text: a.text });
    const out: Obj = {};
    for (const k of ["userstories", "tasks", "issues", "epics"]) if (r[k]?.length) out[k] = r[k].map(summarize);
    if (r.wikipages?.length) out.wikipages = r.wikipages.map((w: Obj) => w.slug);
    return out;
  });

  tool(
    server,
    "taiga_api",
    "Chiamata diretta a qualunque endpoint dell'API Taiga v1 (path relativo, es. 'wiki', 'projects/12/stats', 'epics/5/related_userstories'). Per PATCH su elementi versionati includi 'version'. Usalo per ciò che gli altri tool non coprono; per DELETE chiedi prima conferma all'utente.",
    {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      body: z.unknown().optional(),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async (t, a) => {
      const path = a.path.replace(/^\/?(api\/v1\/)?/, "");
      if (/^https?:|\.\./.test(path)) throw new TaigaError("Path non valido");
      return (await t.req(a.method, path, a.body, a.params)) ?? { ok: true };
    },
  );
}
