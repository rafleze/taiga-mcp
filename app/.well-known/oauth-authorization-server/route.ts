import { publicOrigin } from "@/lib/config";
import { cors, json } from "@/lib/oauth";

export function GET(req: Request) {
  const o = publicOrigin(req);
  return json({
    issuer: o,
    authorization_endpoint: `${o}/authorize`,
    token_endpoint: `${o}/token`,
    registration_endpoint: `${o}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["taiga"],
  });
}

export const OPTIONS = cors;
