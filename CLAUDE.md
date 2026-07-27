# youtrack-cli

A thin wrapper over the YouTrack REST API, published as `@apytel/youtrack-cli` and
installed as the `yt` command.

It serves two consumers at once: an **AI agent** (minimum tokens, deterministic
output) and a **human** (readable enough to hand to someone else). Everything below
follows from that.

## Language

Repository artifacts — code, comments, docs, commit messages, issues — are in
**English**. Conversation with the maintainer happens in Ukrainian.

## Design rules

- **Thin means thin.** The wrapper shapes requests and formats responses. It does
  not model YouTrack's schema. Custom fields are arbitrary per instance — never
  hardcode their names.
- **Mutations go through YouTrack's command language** (`POST /api/commands`), not
  through typed subcommands. See ADR-0001.
- **The token never touches disk.** See ADR-0002.
- **One output path, not two.** The default rendering is compact enough for an
  agent and readable enough for a human; colour is enabled only when
  `process.stdout.isTTY`. `--json` returns YouTrack's raw response, unmodified.
- **Every request carries an explicit `fields=` projection.** Without one the API
  returns either nothing useful or an order of magnitude too much.
- **Zero runtime dependencies except `@napi-rs/keyring`.** Node 18+ provides
  `fetch`, `FormData`, `node:util.parseArgs` and `node:test`. Reach for those.

## Known API traps

- `customFields` is a **repeated** query parameter. `customFields=State,Assignee`
  returns HTTP 200 with an empty `customFields` array — silently wrong, not an
  error.
- The command language cannot set `summary` or `description`. Those need
  `POST /api/issues/<id>`.
- Creating an agile board without `columnSettings` succeeds but produces an
  unusable board. Columns reference field values **by name**.
- Board columns can only reference states that already exist in the project's
  bundle.

## Testing

Unit tests and a fake YouTrack server (`node:http`) run in CI and require no
secrets. Live tests run locally against a real instance, are opt-in, and must
clean up everything they create. **No token ever reaches CI.**

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, driven by the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` and one `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
