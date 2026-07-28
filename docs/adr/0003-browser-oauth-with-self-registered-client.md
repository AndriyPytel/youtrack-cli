# ADR-0003: Browser OAuth, with a client the CLI registers for itself

**Status:** superseded by [ADR-0004](0004-cimd-client-id.md) — 2026-07-28. The
measurements below were taken with *Allow automatic OAuth client registration via
CIMD* switched off, which is the default; enabling it removes the bootstrap
entirely.

## Context

Pasting a permanent token works, but it is the weakest link in the design: the
token is long-lived, usually carries administrator scope on a personal instance,
and travels through a clipboard.

The obvious alternative is what `gh auth login` and `acli login` do — open a
browser, confirm the scope, done. That pattern relies on the CLI shipping a
`client_id` registered with the provider. It works because GitHub and Atlassian
are each a single provider.

YouTrack is not. Every instance runs its own Hub with its own client registry and
its own issuer, so there is no client id to ship. Measured against a live instance
on 2026-07-28:

- `registration_endpoint` is absent from the discovery document and
  `POST /hub/api/rest/oauth2/register` returns 404 — no dynamic client
  registration.
- `client_id_metadata_document_supported: false` — no URL-based client ids.
- `grant_types_supported` has no `device_code` — no device flow.
- Listing services without authentication returns HTTP 200 and an empty list —
  even the YouTrack service id needed for the scope cannot be discovered
  anonymously.

So the browser flow cannot bootstrap itself from nothing.

But it can bootstrap from one authenticated call. Also measured:

- `POST /hub/api/rest/services` with a token creates an OAuth client returning no
  secret — a public, PKCE-only client — and accepts a `http://127.0.0.1:<port>`
  redirect URI.
- `GET /hub/api/rest/oauth2/auth` with that client id, `S256` PKCE and the
  YouTrack service id as scope redirects to the login page as expected.

## Decision

`yt login` uses browser OAuth as its normal path. On an instance it has never seen,
it first bootstraps:

1. Ask for a permanent token, once.
2. Use it to register a `yt-cli` OAuth client with a loopback redirect URI, and to
   look up the YouTrack service id used as the scope.
3. Discard the token. It is never stored.
4. Run authorization code + PKCE against the new client and keep the refresh token
   in the OS keychain.

Every later login on that instance is browser-only.

`YT_TOKEN` remains a first-class path — for CI, for containers, for headless
Linux, and for anyone whose account cannot register a service.

## Consequences

**Gained.** No long-lived administrator token at rest. What is stored is a refresh
token bound to our own client, revocable on its own. Access tokens expire in about
an hour. The granted scope is visible in the browser before it is granted. After
one paste, the maintainer never handles a token again.

**Paid.** Roughly 150 lines: loopback server, PKCE, code exchange, refresh on 401,
a lock so concurrent agent invocations do not refresh at once, client registration,
scope discovery. Three authentication states instead of one.

**Unverified.** Registering a service is very likely an administrator-only
operation; the test instance has one live user, so this could not be confirmed. A
non-admin on a shared instance will most likely see 403 during bootstrap and fall
back to `YT_TOKEN`. This must be handled with a clear message, not a stack trace.
