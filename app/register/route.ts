// Dynamic Client Registration (RFC 7591), stateless: il client_id contiene i redirect_uri cifrati.
import { seal } from "@/lib/seal";
import { cors, json, oauthError, redirectUriProblem } from "@/lib/oauth";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body JSON non valido");
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10) return oauthError("invalid_redirect_uri", "redirect_uris obbligatorio");
  for (const u of uris) {
    const problem = redirectUriProblem(u);
    if (problem) return oauthError("invalid_redirect_uri", `${problem}: ${u}`);
  }
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 80) : undefined;
  const clientId = seal("client", { r: uris, n: name });
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export const OPTIONS = cors;
