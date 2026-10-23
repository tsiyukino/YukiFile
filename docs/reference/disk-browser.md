# The disk browser, and adding by hand

What is on disk, lined up against what the library holds, and the flow that
turns one into the other.

A scan is one plugin's answer to "what counts as an object here", and the
explorer's answer is *everything*. A person organising a library has a
different answer for different folders — this one is a product, that one is
forty textures belonging to its parent — and this is where they give it.

## The parts

| file | does |
|------|------|
| `src/ui/disk.ts` | the comparison: a walked level against the recorded paths |
| `src/ui/DiskBrowser.tsx` | the pane: one directory at a time, marked |
| `src/ui/add.ts` | what was chosen and typed, as the object to create |
| `src/ui/AddObject.tsx` | the page: pick what it is, answer each plugin, add |
| `src/ui/Forget.tsx` | the counterpart, with a question in front of it |

The pure modules carry the parts worth checking on their own. `disk.ts` is
tested against the real library's 441 paths, one directory at a time, because
the one bug that matters there is a join and a fixture written beside the code
agrees with the code. `add.ts` is tested for the property a blank form must not
lose.

## The browser

`fs.walk` with a depth of one, and `path.list` for what the library holds. Both
are fetched together rather than the listing first and the marks after: a list
that draws unmarked and marks itself a moment later is one where somebody can
press "add" on a recorded row in between.

A row says one of two things beside its name. **recorded**, when the library
holds an object there; otherwise a size, since a size is what tells a stub from
the real file. A new folder says nothing, because it has no size until it is
walked.

Clicking a recorded row **opens its object**. Clicking a new one **offers to
add it**. The browser is also a way of finding an object by where it sits,
which the object list cannot do once a plugin has grouped things differently
from the disk.

The chevron on a folder opens it, and opening is not choosing — the same rule
the object list keeps. A person looking inside a folder has not asked to add
it.

**Hide recorded** filters the rows and leaves the count alone: "12 entries, 9
recorded" describes the directory, and a count that changed with the toggle
would describe the toggle.

## Adding

Two steps, and the second belongs to plugins.

**What is it?** A checkbox per semantic property the installed plugins
declare, from `picker.choosable`. Factual properties are not offered: a `.pdf`
is a pdf without anybody saying so, and offering it would invite marking a
`.docx` as one. A dotted name reads as its last segment, within the rest —
`booth`, within `vrchat` — because the dot is the model's own nesting rather
than part of the name.

Choosing nothing is allowed, and is what the page says when no plugin offers a
type: the object is recorded as what it observably is, which is what a scan
would have done.

**Each plugin asks.** Every chosen property whose plugin contributes a form
gets a step, in mount order from `picker.formsFor`. The form is handed the
path, so it can suggest a title from the filename, and it hands values back
through `onDone`; it never writes. A form that refuses — a DOI that will not
parse — stops the step with its reason rather than quietly dropping the field.

**Going back keeps what was typed.** `FormProps.initial` is the previous
answer. Cancelling discards everything, which is why people confirm with blank
forms rather than cancel, and why a blank form has to keep its property.

**A form that did not load does not lose the choice.** The page says which
plugin's form is missing and offers to continue; the property is attached with
no values, and `store::carried` keeps it until something fills them in.

### What is sent

`add.newObjectFrom`. Every chosen property is listed whether or not its form
returned anything — `2026-09-11_choosing-a-type-is-storable.md` records what
happened when a blank form dropped the choice. Values are nested under the
property they came from, so the core spells `paper#1/doi` itself and a form's
bare `doi` never reaches the shared field space. A form that returned nothing
contributes no entry rather than an empty one.

The location is sent with the kind the walk saw. The core does not look twice;
`bridge::objects` says why.

### When the core refuses

`problem.describe` turns the bridge's tagged refusal into a sentence. Two tags
get their own, because a person can act on them: a **taken path** names the
path, since between the walk and the click something else may have recorded
it; a **vanished path** says so, since the file may have been moved while the
form was open. Everything else keeps its tag — "the core refused: bad_request"
is a bug report, not a message, and it should read like one.

After a refusal the page stays. The person can cancel or try again; a page that
closed on failure would make the failure look like success.

## Forgetting

A **Forget** button above every object page. It asks first, in words that say
what is lost — the properties, the values, where it sits — and what is not:
the files on disk. `object.forget` is on `APP_ONLY` for the reason
`plugin::commands` gives: a person deciding to forget something is the review,
and a plugin doing it for them is not.

Primer's `ConfirmationDialog` watches its body with a `ResizeObserver`, which
jsdom does not have. `src/ui/setup.ts` stubs one, beside `matchMedia`, for the
same reason: a component that throws from an effect after rendering reads as a
failure in whichever test ran last.

## After either

The shell bumps its generation and re-reads the library. The object list holds
the new object; the browser marks its row; and the page shows what was just
made, since the next thing a person does after adding something is look at it.
