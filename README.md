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
| `ALLOWED_REDIRECT_HOSTS` | no | Comma-separated hosts (e.g. `claude.ai,claude.com`). When set, `https` redirect URIs are accepted only on these hosts; loopback redirects (Claude Code) stay allowed. Exact match, no wildcards or ports. |
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
- `client_id`, authorization codes, access tokens (1 h) and refresh tokens (30 days) are AES-256-GCM sealed with `TOKEN_SECRET`. No storage.
- The Taiga password is used once, to get a Taiga session, and is never stored. On refresh the server renews the Taiga session through `auth/refresh`.
- Taiga is called from the server, so your instance must be reachable from the internet. VPN-only instances need a self-hosted deployment inside the network.

### Security notes

- Every user's access is limited to what their Taiga account can do.
- The Taiga password is forwarded once to Taiga and is never stored or logged. The sealed tokens contain the Taiga session (auth token and refresh token, or the pasted token), so `TOKEN_SECRET` must stay secret.
- SSRF protection: only `https://` instances are accepted, and before every request to Taiga the host is resolved and refused if any of its addresses is private, loopback, link-local, CGNAT or reserved (IPv4-mapped IPv6 included). Redirects are not followed. A DNS answer that changes between the check and the connection is not covered, so deployments inside a private network should also set `TAIGA_LOCKED_URL`.
- `taiga_api` only reaches paths under the API of the user's own instance. Absolute URLs, `//`, backslashes, whitespace and `..` (plain or percent-encoded) are refused.
- Refresh tokens last 30 days and require the `client_id` they were issued to. Each refresh issues a new one.
- The design is stateless, so codes can't be revoked server-side before they expire (2 minutes, bound to client + PKCE), and refresh tokens can't be revoked individually: after rotation the previous one stays valid until it expires. Rotating `TOKEN_SECRET` revokes everything.
- Client registration is open, as MCP clients require. Anyone can register a client name and a redirect URI and send a user a link to the login page, so the page shows the host the user will return to. Set `ALLOWED_REDIRECT_HOSTS` to rule this out.
- There is no built-in rate limiting (no storage to count on). Put it in front of the server, see below.
- Content read from Taiga (descriptions, comments) is written by other people and reaches the model as is. Keep human confirmation enabled in your MCP client for write and delete tools.

### Hardening a deployment

- **Rate limiting.** In Vercel: project → **Firewall** → add a rate-limit rule for `POST /authorize` and one for `POST /token`, keyed by IP (for example 10 requests per minute on `/authorize`, 60 on `/token`), action *deny* or *challenge*. Without it, `/authorize` can be used to guess passwords against any Taiga instance. On other hosts use the reverse proxy (nginx `limit_req`, Cloudflare).
- **Company deployments.** Set `TAIGA_LOCKED_URL` so the server only talks to your instance, and `ALLOWED_REDIRECT_HOSTS` with the hosts of the MCP clients you use (for Claude: `claude.ai,claude.com`). The restriction also applies to clients registered before it was set. Set `PUBLIC_URL` so the OAuth metadata never depends on request headers.
- **Emergency revocation.** If a token may have leaked, change `TOKEN_SECRET` and redeploy: every client registration, code, access token and refresh token stops working and users sign in again. Users should also change their Taiga password, which is the only way to end the Taiga session itself.
- Never set `ALLOW_INSECURE_URLS` in production: it turns the SSRF protection off.

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
