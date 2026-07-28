# ADR-0004: One OAuth flow, with a CIMD client id

**Status:** accepted — 2026-07-28. Supersedes ADR-0003.

## Context

ADR-0003 bought browser OAuth at the price of a bootstrap: paste a permanent
token once per instance so the CLI can register an OAuth client for itself and
look up the YouTrack service id. That was the cheapest path available at the
time, and it was measured, not guessed — the instance really did report
`client_id_metadata_document_supported: false` and really did 404 on dynamic
client registration.

What that measurement missed is that the flag is a **setting**, off by default.
YouTrack 2026.2 added *Allow automatic OAuth client registration via CIMD* under
Access Management > OAuth Clients. Re-measured on 2026-07-28 with it enabled:

- `client_id_metadata_document_supported: true`.
- `GET /.well-known/oauth-protected-resource/mcp` returns HTTP 200
  **unauthenticated**, carrying `scopes_supported: [<YouTrack service id>]` —
  the one value ADR-0003 needed a token to discover.
- `GET /hub/api/rest/oauth2/auth` with `client_id` set to an HTTPS document URL
  redirects to `/hub/auth/login`, not to `/hub/auth/oauth/error`.

That last point matters beyond the docs: JetBrains describes CIMD as a feature
for MCP clients, but Hub honours a CIMD client id on the ordinary authorization
endpoint too. Timing the same request with three different client ids showed Hub
fetching the document — 0.20s for an opaque id it rejects outright, 0.33s and
0.52s for two URLs it goes and reads.

Dynamic client registration is still absent, and that is fine. CIMD is not
registration: the client id *is* the URL of a metadata document we host, and the
authorization server reads it on demand.

## Decision

There is exactly one OAuth flow, and it registers nothing.

1. `client_id` is a constant compiled into the CLI:
   `https://andriypytel.github.io/youtrack-cli/client.json`, served from
   `docs/client.json` by GitHub Pages.
2. The scope comes from the instance's protected resource metadata, fetched
   without a credential.
3. Authorization code + PKCE against the instance's Hub, refresh token to the OS
   keychain.

`yt login` therefore asks for nothing at all. The redirect URI is fixed at
`http://127.0.0.1:8637/callback` because the metadata document declares that
exact value, so `--port` and `--client-id` are gone along with the per-instance
`instances` block in the config file.

A permanent token remains the fallback — `yt login --token` and `YT_TOKEN` — for
CI, for headless environments, and for instances where the CIMD setting is off.

## Consequences

**Gained.** Nothing is pasted, nothing is registered, nothing is stored per
instance. A first login on a new instance is identical to the tenth. No
administrator rights are needed, which removes ADR-0003's unverified assumption
that registering a service is admin-only.

**Paid.** The client id is now a URL we must keep serving. If GitHub Pages goes
away or the path changes, every OAuth login breaks until the constant is updated
and released — the token fallback is what keeps that from being an outage. The
document is public by construction; it holds no secret, only a name and a
loopback redirect URI.

**Depends on a setting we do not control.** CIMD is off by default, so most
instances land on the token fallback until an administrator enables it. The CLI
detects this from the discovery document and says which switch to flip rather
than failing in the browser.
