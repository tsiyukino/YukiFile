# contract

The shape of everything that crosses the library's edge.

One contract serves three cases: exporting a library for an AI to read,
importing what it suggests, and moving between machines. A future MCP server is
a protocol wrapper over this rather than a second way into the data — which
only holds if the three really are one shape, so they are.

## Document

```rust
struct Document {
    version: u32,
    source:  Option<String>,     // where these came from
    objects: Vec<ObjectRecord>,
    terms:   Vec<TermRecord>,
}
```

`Document::parse(&str)` · `Document::to_json()` · `VERSION`

A document from a **later** version is refused rather than read partially. A
later build may mean something different by a field this one knows, so
importing three quarters of it is worse than declining. An unknown *field*, by
contrast, is ignored — otherwise every addition would be a breaking change.

Absent fields are omitted rather than written as `null`, and values serialise
in sorted order. Both matter for the same reason: two exports of one library
should diff cleanly, and a document that is mostly nulls is one a person cannot
read.

## ObjectRecord

```rust
struct ObjectRecord {
    paths:  Vec<String>,              // locations; empty for a grouping
    id:     Option<String>,           // stable name when there is no path
    values: BTreeMap<String, String>, // "booth#1/price" -> "2900"
    edges:  Vec<EdgeRecord>,
    reason: Option<String>,
}
```

### Fields are carried, not enumerated

The seed library's own export shows why: of 179 source records, `note` appears
on 38, `same_product_as` on 7, `reclassify` on 3. A struct with a field per key
would be mostly `None`, and every plugin adding a property would mean editing
it.

So a record carries value paths and values — the same pairs `values_` holds.
The core moves them without knowing what any of them mean.

### Matching is on path, and importing is idempotent

Importing one document twice changes nothing the second time. That is what
makes an import safe to retry after a failure, and what lets an
export-and-reimport be a test of the round trip rather than a source of
spurious changes.

A grouping has no path to match on, so it carries `id` instead — a second
import updates the grouping rather than making another.

### Reasons

`reason` is required on anything a machine suggested and absent from a plain
export.

Not decoration: during the manual cleanup a classifier repeatedly filed outfits
as editor tools because they bundled lilToon, and the mistake was only obvious
once the reasoning was visible. A suggestion reading "contains Editor/*.cs" is
one a person can reject on sight.

## EdgeRecord and TermRecord

An edge names `object` (a path) **or** `term` (`avatar:manuka`), never both and
never neither — as in the edge table. `is_well_formed()` reports a record that
does; nothing resolves it to a guess.

`EdgeRecord::to_object(kind, path)` · `EdgeRecord::to_term(kind, vocab, term)`
· `term_parts()`

`TermRecord` carries a term and its spellings: `桔梗`, `Kikyo`, `Kikyou`.
