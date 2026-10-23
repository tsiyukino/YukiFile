# The review screen

Deciding what a proposal may write, entry by entry.

The one GitHub interaction `2026-09-01_ui-primer-not-github-clone.md` says to
copy on purpose. A change set is a pull request, an object is a file in its
diff, a field is a hunk, and each is accepted or declined on its own.

## Why it had to exist before any plugin that writes metadata

`import.propose` is how anything outside the application changes the library.
What fits into an empty field is written on the spot; anything that would
overwrite a value somebody chose waits in a change set. Until this screen, it
waited where nothing could see it — the core could list, accept and apply a set
and no command reached any of that. A plugin proposing a title that differed
from the one a person typed put the value nowhere.

Every plugin the roadmap wants next — a VRChat scan, a shop fetch, an AI import
— disagrees with the library sooner or later. This is where the disagreement
goes.

## The parts

| file | does |
|------|------|
| `src/ui/review.ts` | grouping by object, an entry in words, the counts |
| `src/ui/Review.tsx` | `ReviewList`, the pane; `ReviewPage`, the set |
| `src-tauri/src/bridge/changes.rs` | the six commands, see [changes.md](changes.md) |

The pure module carries what is worth checking without a DOM: that entries are
grouped by the object they touch in the order the core gives them, that
clearing a field is said rather than drawn as an arrow to nothing, and that the
counts a person reads add up.

## The pane

Every open set, oldest first, as a row: its label and one line of counts —
"3 additions and 1 modification, 3 accepted". The counts ride along from the
core because a list of labels is a click to find out, and a line of counts is a
decision. The segment's own label carries the number of sets, so a scan that
left something to decide is noticed from anywhere.

## The page

Entries grouped under the object they touch, named the way the object list
names things — the title, or the filename. Each entry is a checkbox with the
field and a sentence: *would set "x"*, *would replace "mine" with "theirs"*,
*would clear "mine"*. A reason, when the proposal carried one, sits under it.

**A modification starts unticked; an addition starts ticked.** That is the
core's default and the screen only shows it. Pressing Apply without reading
loses nothing a person chose.

**Each tick is written at once** through `changes.accept`, and reflected
locally rather than re-read. A review half done survives closing the window,
and the screen does not refetch the set on every click.

**A bulk action re-reads the set.** Accept additions, accept all and decline
all change many rows by a rule the core owns; reading the result back is
cheaper than reimplementing the rule to predict it, and cannot drift from it.

**Apply writes everything accepted in one transaction, or nothing.** The
button says how many of how many, so the number is in front of the person
before they press it.

### A field that moved

Between the proposal and the review, something else may have changed a field —
another import, a person editing. Applying would overwrite that without anyone
seeing it, so the core refuses with the object, the field, what the proposal
was built against and what is there now.

The screen puts that sentence **beside the entry it is about**, not as a line
at the bottom. "A field moved" sends the person hunting; "title changed since
this was proposed: it was "mine" and is now "changed meanwhile"" is the
decision laid out. The set stays open. What to do about it — decline the
entry, or rebuild the set — is theirs.

### A set that is gone

Read failures are shown as the refusal they are. A set that was applied from
another window, or never existed, gets a blank slate saying so; neither is
drawn as an empty review, because "nothing proposed" and "no such set" are
different facts.

## After applying

The shell bumps its generation and re-reads the library. The pane shows what
is still waiting, the page returns to the object, and the object list and the
disk browser pick up whatever the set wrote.
