# ADR-0005: A value set, not a workflow

**Status:** accepted — 2026-07-28.

## Context

"Change the status flow" is one phrase covering two things YouTrack keeps far
apart.

The first is the **set of states itself**. Measured against the REST API:
`StateBundleElement` exposes `name`, `isResolved`, `archived`, `ordinal`,
`description` and `color`, all writable, plus `POST` on
`/api/admin/customFieldSettings/bundles/state/{bundleID}/values/{elementID}` to
update one of them and `DELETE` to remove it. Adding, renaming, hiding, ordering
and marking a state as resolving are therefore ordinary requests — exactly the
shape this wrapper already has.

The second is the **transitions between states** — "from Open you may only go to
In Progress". YouTrack has these, as *state-machine rules*, and they are not
data. They are JavaScript against `@jetbrains/youtrack-scripting-api`, authored
in the workflow editor. The REST API offers no endpoint that creates a
transition; the only programmatic route is uploading a zipped workflow package.

The two look alike from the outside, which is the whole problem: a command that
reorders states will be read as a command that governs movement between them.

## Decision

`yt state` and `yt type` operate on the **value set** and stop there.

They add, rename, reorder, archive and — for states — set `isResolved`. They do
not create, read or modify transition rules, and the CLI will not generate
workflow JavaScript.

`DELETE` is not exposed either. Archiving hides a value without touching the
issues that already carry it; deletion is the same intent with data loss
attached, so the destructive half of the pair is simply absent.

`yt state` and `yt type` are one implementation under two names. The field name
is a **default in code** (`State`, `Type`), overridable with `--field`, not a
hardcoded constant and not configuration: nothing new is written to disk, and an
instance that names the field otherwise costs one flag.

## Consequences

**Gained.** Everything a value set can express is reachable in one round trip,
with no schema modelling on our side. The old hardcoded `'State'` lookup is gone
— the bundle's kind is read from `$type`, so a version or ownedField bundle works
through the same code.

**Paid.** Restricting movement between states remains a web-UI task. Someone who
asks the CLI for "the flow" gets the vocabulary, not the rules, and has to be
told where the rules live. We accept that rather than become a code generator
for someone else's runtime — generated workflow JavaScript would need its own
versioning, would collide with rules already installed on the instance, and
could not be reliably undone.

**Boards inherit the distinction.** Once a state can be archived, `yt board new`
has to know about it: archived states are dropped from the default column layout,
and naming one explicitly in `--columns` fails before the board is created. A
column on an archived state is a column no issue can ever enter.

**Not atomic.** `order` writes `ordinal` one value at a time, because that is the
only way the API takes it. An interrupted reorder leaves the set partly
rearranged. This is why ordering is its own subcommand and not a flag alongside
`--rename`: the cost is not the same, and the interface should not pretend it is.

**Blast radius is reported, not prevented.** A value set can belong to several
projects, so `yt type add DEMO …` may land in projects nobody named. The command
performs the write and prints which projects share the set. Gating it behind a
confirmation flag would cost an agent a failed call and a retry on the common
path, to prevent an additive, visible change.

## Addendum — 2026-08-11: a third name, and no `--field`

The decision above made the field name "a **default in code**, overridable with
`--field`". Measurement afterwards showed the override already reached every
value-set field — `Subsystem`, `Fix versions`, `Fixed in build` — so the flag was
not a fallback for an oddly named `State`, it was the general command wearing a
disguise.

`yt field ls|add|edit|order <project> <field> …` is that command under its own
name, with the field as a positional. `--field` is removed: one job, one way to
ask for it. `yt state` and `yt type` stay as fixed-field aliases, because
onboarding scripts call them and the short name costs nothing. A rejection of
`--field` names `yt field` rather than letting `parseArgs` answer "Unknown
option", since that is where a stale habit gets corrected.

Value attributes follow the same measurement: `description` sits on the shared
bundle-element ancestor and is taken by any field, while `released` and
`releaseDate` exist on version values alone and are refused elsewhere — the way
`--resolved` is already refused outside `State`.
