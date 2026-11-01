# Issue tracker: tsk board

Issues for this repo live on the local **tsk** board, in the `noteharbor`
project. tsk takes its project name from the Git repo root, so run every
command from this repo and the scope is implicit. The board is user-local and
is not committed to git.

The GitHub remote is only for code. GitHub Issues is not used: never call
`gh issue` for work in this repo.

## Vocabulary

- **Ticket**: one tsk task, addressed by its board number (`T12`; `12` and the
  UUID work too). Prefer `T12` — it is what the user sees.
- **Status**: the ticket's state — `open`, `ready`, `started`, `blocked`,
  `review`, `done`.
- **Thread**: the ticket's category — `bug` or `enhancement` (see
  `triage-labels.md`). The `wayfinder` thread is reserved for maps.
- **Spec**: a markdown file at `.scratch/<feature-slug>/spec.md`. A spec is not
  a board task; tickets link to it from their notes.

## Read

- One ticket in full: `tsk list T12 --json`
- This project's live tickets: `tsk list --json`
- Untriaged inbox: `tsk list --open --json`
- On deck: `tsk list --ready --json`
- Closed / archived: `tsk list --done --json`, `tsk list --archived --json`

Always pass `--json` and read fields, not presentation. Never pass `--state-dir`
unless the user asked: it points at a different board.

## Create a ticket

`tsk add -t "<verb-first outcome>" -n "<notes>" --thread <bug|enhancement>`

- **Title**: the outcome, verb-first, about 60 characters.
- **Notes**: what the issue asks for, what is settled, acceptance criteria, and
  a `Spec: <path>` line when a spec exists.
- **Thread**: exactly one category, `bug` or `enhancement`.
- **Blocking**: put `Blocked by: T12, T13` in the notes *and* set the native
  edge with `tsk edit T14 --after T12 --after T13`.

Many at once: `cat plan.json | tsk add`. On exit 1, retry only the `failed`
items.

## Update a ticket

- **Notes / comments**: `tsk edit T12 --append-notes "..."` appends below the
  notes. Never rewrite someone's words with `--notes` without asking.
- **Triage state**: change the status (see `triage-labels.md`).
- **Blocking**: `tsk edit T14 --after T12` replaces the list; `--clear-after`
  removes it.
- **Who it waits on**: `tsk edit T12 --on <you|agent:<name>|other:<text>|T12>`.

`tsk reply` only works while a block or review is open, and is not safe to
blind-retry.

## Close a ticket

- **Done**: `tsk status T12 done` — only when the user says it is done. A done
  task starts the ready tasks waiting on it.
- **Won't fix**: append the reason, `tsk status T12 done`, then `tsk archive T12`.
- **Delete**: the user's call; `tsk list --deleted` shows the trash.

## Blocking and the frontier

`--after` is the native dependency edge. Starting a task before its `after`
tasks are done refuses with `after-not-done`; add `--force` only when the user
says to start anyway.

- **Frontier**: `tsk list --ready --json` (picked and unblocked), plus
  `tsk list --open --json` for tickets never picked up.
- **Claim**: `tsk status T12 started --no-dispatch` when you do the work
  yourself. Starting an *assigned* task without `--no-dispatch` dispatches it
  to its agent instead.

## Wayfinding (used by `/wayfinder`)

tsk has no labels, so a wayfinder map and its ticket types are recorded like
this:

- **Map**: one task on the `wayfinder` thread, titled `<effort> map`. Its notes
  hold the destination, the current state, and the decisions-so-far index (one
  line per resolved ticket).
- **Child ticket**: a task on the `wayfinder` thread whose notes start with
  `Type: research|prototype|grilling|task`.
- **Blocking**: `Blocked by: T<n>` in the child's notes, plus the native edge
  via `tsk edit T<n> --after T<m>`.
- **Claim**: `tsk status T12 started --no-dispatch`, assigned to `me`.
- **Resolve**: append the answer under `## Answer`, `tsk status T12 done`, then
  add the gist and ticket number to the map's decisions list.
- Close the map last, once every child is done.

## Requests covered by triage

There is no external request surface: triage reads the board only. Pull
requests on GitHub are code review, not triage input.

## Legacy

`.scratch/` still holds pre-tsk local-markdown tickets (`tauri-port/`,
`table-view-prototype/`). They are historical: do not publish there, do not
import them, and do not treat them as live. Read one only when the user points
at it.
