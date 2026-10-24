# The object page

What a person sees when they open an object, and where plugin panels land.

v1 ships no layout ownership (`2026-09-02_v1-scope-revised.md`), so this is
what every object gets. A plugin contributes into it; nothing replaces it.

## What meets here

Three answers arrive from three places, and the page decides none of them:

| from | says |
|------|------|
| `object.flat` | what the object holds, resolved into shared fields and regions |
| `slots.panelsFor` | which panels belong to it, in mount order |
| `loader.loadAll` | which of those modules actually came back |

The page's own job is the small part: headline first, then the remaining shared
fields, then one region per property instance in the order the object gives
them — which is mount order, sorted in the bridge and not re-derived here.

## Sources, not winners, made visible

A product on two shops has three titles and all three are true. `SourceList`
shows the first and puts the rest one click away, each attributed to the
property instance it came from (`booth#1`) or to "entered here" for a bare
field.

Hiding the others would make the model invisible exactly where somebody needs
it: the moment they wonder why the title is not what they typed is the moment
the answer has to be reachable.

## Regions

`PropertyRegion` draws one property instance: the fields that plugin keeps to
itself, then whatever panels are scoped to the property.

The instance number appears **only when the object carries that property more
than once**. On a single Booth listing `#1` is noise; on two it is the only
thing telling them apart. Showing it on one and not the other would be worse
than showing neither, which is why the count comes from the whole object rather
than from the instance number.

## Where the object sits

`fs` is a core property in its own table, so locations do not arrive through
`shared` or `regions` like everything else. `object.flat` carries them anyway:
a file manager that cannot say where a file is has not said much, and a second
command to fetch them would make every object page two round trips.

An object with no title is named by its filename. A scan records where things
are before anybody names them, so that is the common case rather than the
exception — and "Untitled" over a file that plainly has a name is the page
refusing to read what is in front of it. A grouping has no location and keeps
"Untitled", because it genuinely has no name until somebody gives it one.

## Carried, not written

`carries` lists every property instance the object has; `regions` lists only
the ones holding fields. Panel visibility keys off the first.

The distinction was invisible until the scan stopped writing a marker. It used
to write `file#1/present = true` so resolution would see the property at all,
which put a row reading **present: true** on every object page — a sentence
that says nothing. Removing it was right, and it exposed that keying panels on
`regions` means a plugin's panel appears only once that plugin has already
written something. A `.zip` is an archive before anything is written about it.

So a carried property with no fields still gets a region, and the plugin scoped
to it draws inside.

## A plugin failing is not the page failing

Two ways a panel can be missing, and both end the same way — the region says
which plugin, and everything else draws:

- its module never loaded (`loader.ts` reported a failure)
- its module loaded and its default export is not a component

The second is what `panelComponent` checks. A plugin is external code; letting
React throw on a number would take the object page down over one bad plugin.
Contributions whose module failed are kept in the list carrying `undefined`
rather than filtered out, because a dropped contribution is a silent gap and a
named one is a bug report.

## Editing

The page edits when it is handed an `app` and an `onChanged`; without them it
is read-only, which is what a panel's tests and an embedded view want. The
shell hands both.

| part | file | writes |
|------|------|--------|
| a field | `FieldEditor.tsx` | `object.value.set` |
| a new field | `FieldEditor.tsx` (`NewField`) | `object.value.set` |
| what it is, points at, sits at | `ObjectEditor.tsx` | the rest of `object.*` |
| the rules | `edit.ts` | nothing; pure |

### Shared fields write bare

A shared field may be showing a shop's title. Editing starts from that text,
because it is what the person is looking at, and saving writes `title` — the
bare field, which outranks every source. That is the model's own answer to
"I want it to say this": a person's value is a source that wins. Clear is
offered only when a bare value exists, because clearing a shop's value is not
a thing a person can do from here, and a button that does nothing is worse
than none.

### Region fields write under their property

`paper#1/doi`, spelled by `edit.fieldPath` and nowhere else in the UI. A
region's field is the plugin's own, so what is shown is what is owned and
Clear is always on offer.

**Add field** is the generic escape hatch. A plugin's form is the right way to
fill a region in; until the plugin has one, this is how a person records a
category on the thing they are looking at. The name is checked against the
store's own rule — no `/`, no `#`, no whitespace — before the round trip, so
the message sits beside the box.

### Is a, points at, sits at

Three lists under the regions, each with a remove per row and one small form.

**Is a** offers removal only for semantic properties — the ones a person could
have chosen. `pdf` on a `.pdf` is attached by what the file is, and detaching
it would do nothing the next read does not undo.

**Points at** lists edges in words: a term by its label, an object by its
name, and the raw id when neither is known, because a target nobody can name
is still a target. A new edge goes to a term from one of the declared
vocabularies, or to an object **by its path**: the person types where the
thing sits, which they know, and the id, which they do not, comes from
`path.list`. Kinds are suggested, not enforced; the schema leaves `kind` free
so a plugin can add `cites` without a change here.

**Sits at** lists locations. Another is added by typing a path relative to the
root and saying whether it is a file or a folder; the core checks it is there
and nobody else's. Typed rather than picked for now — the disk browser is the
natural picker and will become one.

### What is not drawn

A `file` or `folder` region with no fields and no panel is left out: every
object on disk carries one of the two, and a heading over an empty space on
every page says nothing. A grouping's `contains` edges are summarised as a
count rather than listed, since the Library pane draws them when the grouping
is opened.

### After any edit

`onChanged` bumps the shell's generation, which re-reads the object on screen
without changing which object it is. The framework's page shows the model;
a plugin's panel shows the meaning, and both read the same object.

## The panel contract

`plugin-host/panel.ts`

```ts
interface PanelProps { api: Api; objectId: ObjectId; property: string; instance: number }
type Panel = ComponentType<PanelProps>
```

A manifest's `./panel` is relative to **that plugin's directory**, which is why
`Resolve` receives the plugin id alongside the specifier and why discovery
records the directory it read each manifest from. Resolving against the
importing file instead asks for `src/ui/panel` — a 404 for a file that exists,
and a failure that reads as a missing plugin rather than a wrong base path.

The frontend resolves through `import.meta.glob`, not a bare `import()`: a
specifier read out of a manifest is data, and a bundler cannot follow a string
it never sees at build time.

A panel is handed its `api` rather than importing one — the same injection the
loader and command API use, and with the same payoff: a panel is tested by
rendering it with a fake api. It also means a panel cannot widen its own reach,
since the api it receives is built from the allowlist.

`instance` matters: an object with two Booth listings gets two panels, and each
has to know which it is drawing or both render the same thing.

## The archive panel

`plugins/archive/panel.tsx` is the first plugin component, and it uses no
privilege a third party would not get.

The deciding stays in `panel.ts`: `summarise` is a pure function of a listing,
tested without a DOM. The component only turns its answer into elements. That
split is what lets the interesting question — which of 4000 entries to show —
be tested without rendering anything.

## Testing components

`vitest.config.ts` runs two projects: `.test.ts` in node, `.test.tsx` in jsdom.
Node is the default because it is faster and because an accidental DOM
dependency then fails instead of passing quietly.

Two things were needed to make component tests run at all, and both failed in a
way worth naming:

- **Primer imports its own CSS**, which node cannot load. Without
  `server.deps.inline`, the component tests did not fail — they refused to run
  while the suite still reported a passing count.
- **jsdom implements no `matchMedia`**, which Primer's theme asks for on first
  render, and Testing Library does not auto-clean without vitest globals. A
  suite missing the cleanup does not error; it finds the previous test's
  elements and asserts against them.

Both live in `src/ui/setup.ts`.
