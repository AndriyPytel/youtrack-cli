# ADR-0001: Mutations go through YouTrack's command language

**Status:** accepted — 2026-07-28

## Context

Every other YouTrack CLI models mutations as typed subcommands: `issue state`,
`issue assign`, `issue tag`, `issue priority`, and so on. That shape requires the
tool to know which custom fields exist and what their values mean.

It does not. Custom fields in YouTrack are defined per project, with per-project
value bundles. A tool that hardcodes them works on exactly one instance — a
failure mode visible in at least one existing CLI, which shipped one instance's
field names as constants.

YouTrack exposes `POST /api/commands`, taking a string in its own command
language, parsed server-side against the actual schema of the actual issues:

```
state In Progress assignee me tag urgent Fix versions 2026.1
```

The same endpoint accepts `runAs`, attributing the change to another user.

Measured against a live instance on 2026-07-28: two mutations in one call, 2-byte
response. `POST /api/commands/assist` validates a command — both its syntax and
its values — without applying it, and returns a human-readable description of what
would happen.

## Decision

All mutations go through the command language, exposed as a single `yt cmd`
subcommand, with `--dry-run` backed by `assist`.

Editing an issue's `summary` or `description` is the one exception: the command
language does not support it, so those use `POST /api/issues/<id>`.

## Consequences

**Gained.** Custom fields, tags, links, subtasks, priorities and milestones all
work without the wrapper knowing they exist. `runAs` and milestones — the two gaps
that disqualified both the official MCP server and every community CLI — come for
free. One endpoint replaces eight handlers.

**Paid.** The caller must know the command language. For a human that is worse
than `yt issue state DEMO-16 Fixed`; the mitigation is examples in `--help`, not
code. Parser errors originate in YouTrack, not here — `--dry-run` surfaces them
before damage.

**Left open.** Thin aliases over `yt cmd` for the one or two most frequent
mutations can be added later, once real usage says which those are. Adding them
up front would be guessing.
