# Taiga MCP

A remote [MCP](https://modelcontextprotocol.io) server that connects Claude (claude.ai, Cowork, Claude Desktop, mobile, Claude Code) and other MCP clients to **[Taiga](https://taiga.io)**. It works with both self-hosted Taiga and Taiga cloud (taiga.io).

Each user signs in with **their own Taiga instance URL and account**. The server is stateless: no database, nothing stored. The Taiga session travels encrypted inside the OAuth tokens. It deploys for free on Vercel.

## What Claude can do

| Tool | Purpose |
|---|---|
| `taiga_whoami`, `taiga_list_projects`, `taiga_get_project` | Orientation: projects, statuses, members, sprints |
| `taiga_list_items`, `taiga_get_item`, `taiga_search` | Read user stories, tasks, issues, epics (filters: status, assignee, sprint, tags, text, open only) |
| `taiga_create_item`, `taiga_update_item`, `taiga_bulk_create` | Create and edit, move between statuses and sprints, assign, tag, block |
| `taiga_add_comment`, `taiga_get_history` | Comments and change history |
| `taiga_list_sprints`, `taiga_create_sprint`, `taiga_sprint_stats` | Sprints and burndown |
| `taiga_delete_item` | Delete, only with explicit confirmation |
| `taiga_api` | Any other Taiga API v1 endpoint (wiki, custom attributes, epic links…) |

Items are referenced the way people see them in Taiga: project slug + `#ref`. Statuses, users and sprints can be given by name. Taiga's `version` field for optimistic locking is handled automatically.

## Deploy on Vercel (free)

1. Fork this repository on GitHub.
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the fork. Framework: Next.js (auto-detected).
3. Under **Environment Variables**, add `TOKEN_SECRET` with a random value:
   ```bash
   openssl rand -hex 32
   ```
4. Deploy. Your MCP URL is `https://<your-project>.vercel.app/mcp`.

> The Vercel Hobby plan is free but meant for personal, non-commercial use. For company use, consider the Pro plan or any other Node.js host (`npm run build && npm start`).

### Configuration

| Variable | Required | Description |
|---|---|---|
| `TOKEN_SECRET` | yes | ≥ 32 random chars. Changing it signs everyone out. |
| `TAIGA_DEFAULT_URL` | no | Instance pre-filled in the login form |
| `TAIGA_LOCKED_URL` | no | Restrict the server to one instance (company deployment) |
| `TAIGA_AUTH_MODES` | no | Sign-in methods offered: `password`, `ldap`, `token` (default `password,token`) |
| `PUBLIC_URL` | no | Public base URL, if it can't be derived from requests |
| `ALLOW_INSECURE_URLS` | no | `1` allows `http://` and private-network instances. **Testing only.** |

### Sign-in methods

- **password**: Taiga username/email + password (standard Taiga login).
- **ldap**: for instances with the LDAP plugin (`type: "ldap"`).
- **token**: paste a Taiga auth token. Useful for accounts that sign in with GitHub/Google/SSO. In the Taiga web app: DevTools → Console → `localStorage.token`.

## Connect to Claude

**Settings → Connectors → Add custom connector**, paste `https://<your-project>.vercel.app/mcp`, then **Connect**. A page opens where you enter your Taiga instance URL (e.g. `https://taiga.mycompany.com` or `https://tree.taiga.io`), choose the sign-in method and log in. The connector then works in every chat and in Cowork.

On Team/Enterprise plans an owner adds the connector once for the organization, and each member signs in with their own Taiga account.

Claude Code: `claude mcp add --transport http taiga https://<your-project>.vercel.app/mcp`, then `/mcp` to sign in.

## How it works

- OAuth 2.1 authorization server built in: Dynamic Client Registration, PKCE S256, refresh-token rotation. Compatible with the [Claude connector requirements](https://claude.com/docs/connectors/building/authentication).
- `client_id`, authorization codes, access tokens (1 h) and refresh tokens (90 days) are AES-256-GCM sealed with `TOKEN_SECRET`. No storage.
- The Taiga password is used once, to get a Taiga session, and is never stored. On refresh the server renews the Taiga session through `auth/refresh`.
- Taiga is called from the server, so your instance must be reachable from the internet. VPN-only instances need a self-hosted deployment inside the network.

### Security notes

- Every user's access is limited to what their Taiga account can do.
- Instances on `http://` or private/loopback addresses are rejected (basic SSRF protection). `taiga_api` accepts only relative paths on the user's own instance.
- The design is stateless, so codes can't be revoked server-side before they expire (2 minutes, bound to client + PKCE). Refresh tokens can't be revoked individually either. Rotating `TOKEN_SECRET` revokes everything.

## Development

```bash
npm install
cp .env.example .env.local   # set TOKEN_SECRET
npm run dev                  # http://localhost:3000
npm test                     # end-to-end test against a mock Taiga (needs python3)
```

To try it from Claude before deploying, expose `localhost:3000` with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and add the tunnel URL + `/mcp` as a custom connector.

## License

MIT
