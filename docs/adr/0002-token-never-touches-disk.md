# ADR-0002: The token never touches disk

**Status:** accepted — 2026-07-28

## Context

A YouTrack permanent token is long-lived and, on a personal instance, usually
belongs to an administrator. Anything holding it holds the whole tracker.

The common pattern is a keyring with a fallback: store in the OS keychain when
available, otherwise write a dotfile. The fallback is where it goes wrong — one
widely used CLI writes the token to `~/.config/<tool>/.env` with mode `0644`,
warns on stdout, and continues.

The fallback exists because keychains are genuinely unavailable in CI, Docker and
headless Linux, where there is no Secret Service daemon on the bus. That is a real
constraint, not an excuse; it just does not justify writing the secret out.

## Decision

Two sources, and only two:

1. The OS keychain, via `@napi-rs/keyring` — macOS Keychain, Windows Credential
   Manager, libsecret on Linux. The only thing `yt login` writes to. Under
   ADR-0003 what it holds is an OAuth refresh token rather than a permanent one;
   the rule is the same either way.
2. `YT_TOKEN` in the environment, read-only.

The tool never writes a credential to a file, encrypted or otherwise. Where no
keychain exists, the caller exports `YT_TOKEN`; a secret the user deliberately
exported is theirs to manage, not ours to persist. Access tokens and the one-time
bootstrap token of ADR-0003 live in memory for the length of a single process and
are never persisted at all.

The instance URL is not a secret and lives in a plain config file, overridable by
`YT_URL`.

Encrypting a fallback file was rejected: the decryption key has to live somewhere
readable by the same process, which buys obfuscation rather than security.

## Consequences

**Gained.** One sentence in the README that is verifiable by inspection: this CLI
never writes your token to disk. Less code than an encrypted fallback. A
deterministic path for non-interactive agents, which never hit an interactive
prompt.

**Paid.** In an environment with no keychain and no `YT_TOKEN`, the tool fails
instead of degrading. That is the intended behaviour.

**Verified.** Keychain write, read from a separate process, and OS-level
visibility confirmed on macOS arm64, 2026-07-27; no GUI prompt on read. Windows
and Linux are reasoned, not yet tested.
