# youtrack-cli

A thin YouTrack CLI built for AI agents and humans at the same time.

> **Status: implemented, unreleased.** Every command below works against a fake
> YouTrack in CI; the OAuth bootstrap has not yet been exercised against a live
> Hub. See the open issues.

## Getting started

```sh
npm install -g @apytel/youtrack-cli
yt login                    # browser OAuth; the credential goes to the OS keychain
yt ls
```

For CI, containers and headless Linux, skip `yt login` entirely:

```sh
export YT_URL=https://example.youtrack.cloud
export YT_TOKEN=perm:…
```

`yt login --status` says which of the two is in use. `yt login --token` stores a
permanent token in the keychain instead of running the browser flow.

The browser flow needs **Allow automatic OAuth client registration via CIMD**
enabled on the instance — Access Management > OAuth Clients. It is off by
default. Without it `yt login` explains the switch and falls back to a token.

## Why another one

| | this | typical alternative |
|---|---|---|
| Runtime dependencies | 1 | dozens |
| Login | browser, nothing to paste and nothing to register | paste a token |
| Credential storage | OS keychain, or `YT_TOKEN` — **never written to disk** | keychain with a plaintext file fallback |
| `runAs` (attribute work to another user) | yes | no |
| Milestones | yes | no |
| Listing 10 issues with their state | ~380 B | ~2–21 KB |

The size difference is not compression — it is asking the API for the right
fields and printing them without box drawing. The same output is what a human
reads and what an agent parses.

## Interface

```
yt login                                          browser OAuth; credential to the keychain
yt ls [query] [--fields F] [--json]               list issues with their state
yt view <id> [--comments]
yt new <project> <summary> [-d description]
yt edit <id> [-s summary] [-d description]
yt cmd <id...> "<command>" [--as user] [--dry-run]   every other mutation
yt comment <id> <text>
yt attach <id> <file...>
yt art ls|view|new|edit                           knowledge base
yt board ls|new <project> <name> [--columns ...]
yt state ls|add|edit|order <project> ...          the State value set
yt type ls|add|edit|order <project> ...           the Type value set (issue types)
```

`state` and `type` are one command under two names; `--field NAME` points either of
them at a field this instance calls something else. Values can be added, renamed,
reordered, archived, and — for states — marked as resolving the issue. Deleting is
deliberately absent: archiving hides a value without touching the issues that
already carry it.

Mutations go through YouTrack's own command language, so custom fields, tags,
links, priorities and milestones work without this tool knowing they exist:

```
yt cmd DEMO-42 "state In Progress assignee me Fix versions 2026.1" --dry-run
```

`--dry-run` validates the command — syntax *and* values — against the live
instance without applying it.

## Design

- [`CONTEXT.md`](CONTEXT.md) — domain glossary
- [ADR-0001](docs/adr/0001-mutations-via-command-language.md) — why mutations use
  the command language instead of typed subcommands
- [ADR-0002](docs/adr/0002-token-never-touches-disk.md) — why there is no
  fallback file for the token
- [ADR-0003](docs/adr/0003-browser-oauth-with-self-registered-client.md) — why
  the CLI used to register its own OAuth client (superseded)
- [ADR-0004](docs/adr/0004-cimd-client-id.md) — why the client id is a URL we
  host, and how that removed the token bootstrap

## License

MIT
