import { publicOrigin } from "@/lib/config";
import { cors, json } from "@/lib/oauth";

// Servito sia su /.well-known/oauth-protected-resource sia su /.well-known/oauth-protected-resource/mcp
export function GET(req: Request) {
  const o = publicOrigin(req);
  return json({
    resource: `${o}/mcp`,
    authorization_servers: [o],
    scopes_supported: ["taiga"],
    bearer_methods_supported: ["header"],
    resource_name: "Taiga",
  });
}

export const OPTIONS = cors;
