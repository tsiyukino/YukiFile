# changes

Batches of proposed writes, reviewed before they apply.

Writing a value into an empty field just happens. Overwriting a field that
already holds something different produces a proposal instead — a batch shaped
like a pull request, accepted or discarded entry by entry.

The rule itself lives in `values::set`, which writes into a blank and reports a
conflict rather than overwriting. This layer turns that report into a reviewable
entry, so there is one rule rather than two implementations of it.

## Source-agnostic

A set from an AI import, another machine's export, and a shop fetch are the
same kind of thing. There is no per-field provenance beyond a label for whoever
is reading the list, because the question at review time is "do I want this
value" and not "who suggested it".

## changes::build

`import(&conn, &mut values, &document, label) -> Imported`
`import_at(..., clock)` — the same, with the clock injected.

Writes what fits and proposes what does not. `Imported` reports `written`,
`unchanged`, `objects_created` and `pending` — the set id, if anything needed
review. An import with no conflicts opens no set: a review screen with nothing
to review is noise.

Belongs inside `schema::in_transaction`. Half an import is a library describing
something that never existed.

### Matching, and why imports stay idempotent

An object is matched on any of its paths first. If none is known, it is matched
on an identifier — the document's `id`, or its first path — stored under the
reserved `@import/key`.

That second step is load-bearing. An imported object gets **no location rows**:
a document carries values and relationships, not disk state, and it does not
say whether a path is a file or a folder. Guessing would record a zip as a
folder for the next scan to argue with, so locations come only from scanning,
which is the only thing that actually looked.

Without the identifier there would be nothing to match a new object by, and
importing one document twice would make two of everything.

`pending(&conn)` lists sets awaiting review, oldest first.

## changes::apply

| function                              | does                                  |
|---------------------------------------|---------------------------------------|
| `set(&conn, id)`                      | one set, if it exists                 |
| `entries(&conn, set)`                 | what it proposes, in a stable order   |
| `summary(&conn, set)`                 | additions, modifications, accepted    |
| `set_accepted(&conn, change, bool)`   | accept or decline one entry           |
| `accept_additions(&conn, set)`        | accept every addition                 |
| `accept_all(&conn, set, bool)`        | accept or decline everything          |
| `apply(&conn, &values, set)`          | write what was accepted               |

### Additions and modifications default differently

An addition fills a blank and loses nothing, so it starts **accepted**. A
modification overwrites something a person chose, so it starts **unaccepted**.

`accept_additions` follows from that split and is the most useful bulk action
there is: it fills in what is missing without touching a single decision
already made.

### Applying

All or nothing, and it belongs in one transaction with the history it writes.
Half an applied set leaves the library holding sixteen of thirty-one values
with a history batch that reads no differently from a complete one.

A set cannot be applied twice — the second pass would write against an `old`
two versions stale.

**A field that moved since the proposal is refused.** Each entry carries the
value it was built against; if the field holds something else now, someone
changed it in between, and applying anyway would overwrite that without it ever
being seen. `ChangeError::Stale` names the object, the field, and both values.
Rebuilding the set against current values is the way forward, and that is a
decision for whoever is holding the review screen.

Declined entries stay in the set as a record of what was offered and refused.
