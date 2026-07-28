# Context

Glossary for youtrack-cli. Domain language only — no implementation detail.

## Issue

A unit of tracked work in YouTrack, addressed by its human-readable id
(`DEMO-42`), never by its internal id. Every issue belongs to exactly one
**Project**.

## Project

A container for Issues, Articles and its own **State** vocabulary. Addressed by
its short name (`DEMO`). Two projects on the same instance may have entirely
different custom fields.

## Custom field

A named attribute of an Issue whose set of legal values is defined per Project.
`State`, `Assignee`, `Priority` and `Fix versions` are custom fields, not
built-ins. The wrapper never assumes which ones exist.

## Value set

The set of legal values behind a Custom field. **A value set may belong to
several Projects at once**, so a value added through one Project appears in every
Project that shares the set.

## State

The value of the `State` custom field — where an Issue sits in the pipeline. A
State must exist in the Project's Value set before anything can reference it. A
State carries whether it counts the Issue as **resolved**, whether it is hidden
from further use without disturbing the Issues already in it, and its position in
the sequence.

## Issue type

The value of the `Type` custom field. There is no separate type entity, as there
is no separate Milestone entity — types are values in a Value set and are added
the same way States are.

## Command

A string in YouTrack's own command language (`state In Progress assignee me`)
that mutates one or more Issues. The single mechanism for every mutation except
editing an Issue's title or body. Distinct from a **CLI command**, which is a
subcommand of `yt`.

## Run-as

Executing a Command under another user's identity, so the resulting activity is
attributed to that user rather than to the token holder. How work is attributed
to an agent.

## Projection

The explicit list of fields a request asks for. Determines both what comes back
and what it costs. Every request carries one.

## Article

A Knowledge Base page. Belongs to a Project, may have a parent Article, and
carries Markdown content.

## Board

An agile board: a Project plus a column layout derived from one custom field's
values.

## Milestone

A value of the `Fix versions` custom field. There is no separate milestone
entity — milestones are reached through Commands like any other field.
