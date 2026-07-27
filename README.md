# youtrack-cli

A thin YouTrack CLI built for AI agents and humans at the same time.

> **Status: design complete, not implemented.** The interface and the decisions
> behind it are settled and written down; there is no working code yet. See the
> open issues.

## Why another one

| | this | typical alternative |
|---|---|---|
| Runtime dependencies | 1 | dozens |
| Token storage | OS keychain, or `YT_TOKEN` — **never written to disk** | keychain with a plaintext file fallback |
| `runAs` (attribute work to another user) | yes | no |
| Milestones | yes | no |
| Listing 10 issues with their state | ~380 B | ~2–21 KB |

The size difference is not compression — it is asking the API for the right
fields and printing them without box drawing. The same output is what a human
reads and what an agent parses.

## Planned interface

```
yt login                                          store a token in the OS keychain
yt ls [query] [--fields F] [--json]               list issues with their state
yt view <id> [--comments]
yt new <project> <summary> [-d description]
yt edit <id> [-s summary] [-d description]
yt cmd <id...> "<command>" [--as user] [--dry-run]   every other mutation
yt comment <id> <text>
yt attach <id> <file...>
yt art ls|view|new|edit                           knowledge base
yt board ls|new <project> <name> [--columns ...]
yt state ls|add <project> <name>
```

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

## License

MIT
