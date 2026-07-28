# ADR-0006: A generated password, on stderr, once

**Status:** accepted — 2026-07-29.

## Context

`POST /api/users` requires a password. Measured against a live instance on
2026-07-29: the call answers 200 with `login` and `password` in the body, despite
the `User` entity page marking every attribute read-only. There is no documented
force-change-on-first-login flag to make the value single-use, and the account
cannot later be deleted — banning is the only way back.

So `yt user new` has to produce a password and hand it to someone. The obvious
shape, `--password`, is the one thing it must not be: a flag value is visible in
`ps` output to every user on the machine and is written verbatim into shell
history. That is the same failure mode ADR-0002 keeps the token away from.

Reading it from stdin, the way `yt art new` reads content, avoids both. But it
puts the choice of password on the caller, and the callers here are an agent
seeding a project and a maintainer setting up an instance — neither wants to
invent one.

## Decision

`yt user new` generates the password itself: 18 random bytes, base64url. It never
appears in argv.

It is written to **stderr**, not stdout. Stdout carries the login, and under
`--json` it carries YouTrack's raw response — the one output path stays the same
shape as every other command, and a pipe or a redirect cannot silently swallow
the secret.

## Consequences

**Gained.** No secret in `ps`, none in shell history, none on disk. The value
prints exactly once, on a stream that is not usually captured.

**Paid.** The password reaches a terminal, so it can be scrolled back to or
captured by a terminal logger. It is not single-use — the API offers no flag that
would make it so — and the account it belongs to can only be banned, never
removed. Anyone using this to seed an instance should expect to rotate the
password after first login by hand.
