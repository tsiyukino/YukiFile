# The archive plugin

The first built-in, and the first thing to use the extension points end to end:
manifest → discovery → registry → slots → loader → command.

It has no privileges a third party would not get. `boundary.rs` runs its
manifest through the same parser and fails if it needs anything special, which
is the point — if a built-in needs the core to make an exception, the extension
point is wrong and gets fixed before anyone outside depends on it.

## What it declares

```json
{
  "id": "yukifile.archive",
  "contributes": {
    "properties": ["archive"],
    "file_types": { "zip": ["archive"] },
    "panels":     { "archive": "./panel" },
    "columns":    { "archive": ["entries", "unpacked"] }
  }
}
```

`zip` brings `archive`; the panel and columns are keyed to the property the
plugin itself defines. Nothing says where on screen it goes.

### The specifier names no extension

`"./panel"`, not `"./panel.js"`. Which extension the module carries on disk —
`.ts` in development, `.js` after a build, a hashed name after bundling — is
the resolver's business. A manifest that spells one out has to be edited every
time the build output changes, and the two have no reason to be coupled.

`Manifest::check` refuses `ExtensionInSpecifier`, so this is a rule rather than
something to remember. Path syntax is left alone: `./panels/v1.2/Booth` and
`../panel` both pass, because the check looks at the last segment's extension
and not at dots.

## What the panel does

`summarise(members)` → `View` · `open(api, path)` → `View | Problem`

Pure where it can be. `summarise` takes a listing and returns what should be on
screen; `open` is the thin wrapper that fetches one first.

**Nothing here imports a UI framework.** v1 has not decided how panels render,
and a panel reaching for React today would be rewritten when that lands, while
one returning data stays correct either way. It also means the interesting
behaviour is testable without a DOM — and the interesting behaviour is which of
4000 entries to show, not whether a list element appeared.

| the view carries | why |
|------------------|-----|
| `rows` (≤ 50) | a panel is not a file manager |
| `hidden` | so a truncated listing says it was truncated |
| `files`, `folders`, `unpacked` | counted over **every** member, not the visible rows |
| `escaping` | entries whose stored name leaves the archive root |

Counting over the whole archive rather than the truncated rows matters more
than it looks: reporting 50 files because 50 rows fit is a number that quietly
means something other than what it says. The same applies to `escaping` — an
archive with 4000 entries and one `../escape.sh` at the end is exactly the case
worth surfacing, and scanning only the visible rows would hide it.

Nothing is extracted, so an escaping entry cannot overwrite anything today. It
is reported because the name reaches a screen, and because whoever adds an
extract command needs the flag already in the data.

### A problem is not a throw

An unreadable file returns `{ problem }`. A panel that throws takes the object
page with it, and the seed library has a RAR that cannot be opened at all —
that is a fact about the object, not a failure of the page.

The message comes from the tagged error the core sends
(`bridge::error::BridgeError`), so `not_an_archive` reads as a sentence rather
than as `[object Object]`.

## plugin::discover

`in_directory(root) -> Found { manifests, skipped }`

A plugin is a directory holding a `manifest.json`. Discovery reads them; it
does not load them.

**Reading is not loading**, and the two are separate calls because they answer
different questions:

| | scope | on failure |
|---|-------|------------|
| `discover::in_directory` | one directory | skip it, report why, keep going |
| `Registry::load` | the whole set | refuse all of it |

"This directory is not a plugin" leaves the rest unaffected — a half-copied
folder, a leftover `.bak`. "These plugins do not satisfy each other" is about
the set, and starting anyway gives a library where some objects have panels and
others do not for reasons nobody can see. Folding them together would let a
stray directory stop the application, or an unsatisfied dependency pass
quietly.

A directory with no `manifest.json` is not reported at all: a `node_modules`
sitting alongside plugins is not a failure, and saying so on every start trains
people to ignore the list — after which the real skips go unread too.

Results are sorted, because `read_dir` order is the filesystem's business and
two runs over one tree should not disagree about load order. A missing root is
an empty result, not an error: a library with no plugins installed works.

## plugin-host/commands

`apiFor(invoke)` → `Api` · `handlerName` · `methodName`

How a plugin calls the core. `apiFor` takes an `Invoke` rather than importing
Tauri, for the same reason the loader takes a resolver — a panel that imports
`@tauri-apps/api` can only be tested inside Tauri.

Names are derived on both sides and stored on neither:

```
archive.list  ──handlerName──▶  archive_list   (matches bridge::handler_name)
archive.list  ──methodName───▶  archiveList
```

`commands.test.ts` reads `ALLOWED` **out of the Rust source** and checks that
every listed command has a method, that no method exists which is not listed,
and that each method invokes the handler for its own command — the last one
catching a copy-paste that the first two would pass.

Reading the array rather than keeping a copy is deliberate: a copy is a third
place to keep in step, and the failure it produces is a plugin calling
something that no longer exists, in front of a user.
