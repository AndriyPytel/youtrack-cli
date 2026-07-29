# youtrack-cli

A thin YouTrack CLI built for AI agents and humans at the same time.

Every command below runs against a fake YouTrack in CI with no secrets, and the
browser OAuth flow and every write path have been exercised against a live
instance.

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

## What it can do

`--json` on any command returns YouTrack's raw response, unmodified. `yt help`
prints the same list; exit codes are `0` ok, `1` auth, `2` not found,
`3` command rejected, `4` usage.

### Authentication

```
yt login [--url URL]              browser OAuth; the credential goes to the OS keychain
yt login --token                  store a permanent token instead, for CI and headless hosts
yt login --status                 which instance, and which of the two credentials is in use
yt logout                         clear the stored credential
```

### Issues

```
yt ls [query] [--fields F] [--top N]    YouTrack query syntax; state included by default
yt view <id> [--comments]
yt new <project> <summary> [-d text | -f file]     -d and -f omitted: read stdin
yt edit <id> [-s summary] [-d text | -f file]      summary and/or description
yt comment <id> <text>
yt attach <id> <file...>
```

`-d`, `-f` and stdin are three spellings of the same argument, so a multi-line
body never has to survive shell quoting:

```sh
yt new DEMO "Rework the export" -f draft.md
git log -1 --format=%B | yt edit DEMO-42
```

### Every other mutation

Mutations go through YouTrack's own command language, so custom fields, tags,
links, priorities and milestones work without this tool knowing they exist:

```
yt cmd <id...> "<command>" [--as user] [--dry-run]
```

```sh
yt cmd DEMO-42 "state In Progress assignee me Fix versions 2026.1"
yt cmd DEMO-1 DEMO-2 "tag urgent"        several issues at once
yt cmd DEMO-42 "subtask of DEMO-7"       hierarchy, links, anything the field accepts
yt cmd DEMO-42 "state Fixed" --as agent-bot     attribute the work to another user
yt cmd DEMO-42 "state Frozen" --dry-run  validate syntax *and* values, apply nothing
```

`yt cmd --help` carries the worked examples.

### Knowledge base

```
yt art ls [--project P] [--grep text]   an indented tree, ordered as YouTrack orders it
yt art view <id>
yt art new <project> <title> [-f file | -c text] [--parent <id>]
yt art edit <id> [-f file | -c text]
```

`--project` is served by the per-project endpoint, so the result is complete
rather than whatever fits in one page of a global list. `--grep` matches article
titles case-insensitively and filters client-side — the REST API exposes no
server-side article search.

### Project configuration

```
yt state ls <project> [--all]           the State value set; --all shows archived too
yt state add <project> <name> [--resolved] [--archived] [--after "Other"]
yt state edit <project> <name> [--rename X] [--resolved|--no-resolved]
                                        [--archived|--no-archived]
yt state order <project> "Open,In Progress,Fixed"
yt type ls|add|edit|order <project> ...          the same, for issue types
yt board ls
yt board new <project> <name> [--columns "A,B,C"]
```

`state` and `type` are one command under two names; `--field NAME` points either
of them at a field this instance calls something else. Values can be added,
renamed, reordered, archived, and — for states — marked as resolving the issue.
Deleting is deliberately absent: archiving hides a value without touching the
issues that already carry it.

A value set can belong to several projects at once — the stock `Type` field
usually does — so `yt type add` names the other projects a new value just
appeared in.

### Setting an instance up

```
yt project new <shortName> <name> [-d description] [--leader login] [--org name]
yt project team <shortName>             the project team, login and full name
yt project assign <shortName> <login...>   add users to the project team
yt org new <name> [-d description]      an organization to hold projects
yt user new <login> [--name "Full Name"] [--email a@b.c]
```

`--leader` resolves a login to a database id; without it the leader is the
authenticated user. `--org` is optional — a project without an organization is
complete and usable — and a project created this way comes up with the full
default field set, so `yt state ls` and `yt board new` work on it immediately.

`yt project team` lists everyone who reaches the project, whether directly or
through a group; `yt project assign` adds direct members. YouTrack replaces the
member list wholesale on write, so the current members are read and posted back
with the new ones — assigning someone twice changes nothing.

`yt user new` generates the password and writes it to **stderr**, once. It is
never accepted as a flag: argv is visible in `ps` and lands in shell history.

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
- [ADR-0005](docs/adr/0005-a-value-set-not-a-workflow.md) — why `yt state` manages
  a value set and not the transitions between them
- [ADR-0006](docs/adr/0006-a-generated-password-on-stderr.md) — why `yt user new`
  generates the password and prints it on stderr

## License

MIT
