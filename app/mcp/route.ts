// Endpoint MCP (Streamable HTTP). Richiede un access token emesso da /token.
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { unseal } from "@/lib/seal";
import { registerTools } from "@/lib/tools";
import type { TaigaSession } from "@/lib/taiga";

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {
    serverInfo: { name: "taiga-mcp", version: "1.0.0" },
    instructions:
      "Strumenti per Taiga (gestione progetti agile). Gli elementi si indicano con lo slug del progetto e il #ref visibile in Taiga. " +
      "Se non conosci il progetto, chiama prima taiga_list_projects e taiga_get_project per stati, membri e sprint. " +
      "Prima di modificare un elemento verifica con taiga_get_item che sia quello giusto. " +
      "Non eliminare nulla senza conferma esplicita dell'utente. Dopo ogni modifica riporta #ref, titolo e link.",
  },
);

async function verifyToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  const t = unseal<{ s: TaigaSession; c: string }>("access", bearer);
  if (!t) return undefined;
  return {
    token: bearer!,
    clientId: t.c,
    scopes: ["taiga"],
    expiresAt: t.exp,
    extra: { session: t.s },
  };
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
  resourceUrl: process.env.PUBLIC_URL || undefined,
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
export const maxDuration = 60;
