#!/usr/bin/env bash
# End-to-end test: starts a mock Taiga (port 8765) and the server (port 3000), runs the OAuth + MCP flow.
set -e
cd "$(dirname "$0")/.."
export NO_PROXY=127.0.0.1,localhost
python3 test/mock_taiga.py & MOCK=$!
npm run build >/dev/null
export TOKEN_SECRET=$(openssl rand -hex 32) TAIGA_AUTH_MODES=password,ldap,token ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com
ALLOW_INSECURE_URLS=1 npx next start -p 3000 >/dev/null 2>&1 & APP=$!
# second instance with the SSRF guard active (no ALLOW_INSECURE_URLS)
npx next start -p 3001 >/dev/null 2>&1 & STRICT=$!
trap 'kill $MOCK $APP $STRICT 2>/dev/null' EXIT
sleep 4
node test/e2e.mjs
