# Settings

What a library has decided about itself, and the page that shows it.

## The table

`store::settings`: one table of strings, `key` to `value`, in the library's
own database. Copying the library copies its settings, and a plugin's setting
lives beside the data it shapes rather than in the application's own folder.
An empty value clears a key: a blank is the absence of a decision, same as a
blank field.

Keys are namespaced by convention, not by the table. `theme` is the
application's; `vrchat.grouping_depth` is a plugin's. The core reads none of
them: a setting means whatever its reader says it means.

## The commands

| command | list | does |
|---------|------|------|
| `setting.get` | plugin | one setting, by key |
| `setting.all` | app only | every setting, for the page |
| `setting.set` | app only | set or clear one |
| `library.info` | app only | where the library is; what is installed, enabled and running |
| `plugins.enable` | app only | which plugins the library runs, or everything |
| `mount.order.set` | app only | the mounts in a new order, every one named |

`setting.get` is the one a plugin may call: a plugin reads its own keys, as
the VRChat scan reads how deep its groupings go. `setting.set` is not: a
plugin that could write settings could change what another plugin's scan
does, which is the reach the allowlist exists to refuse.

## The page

`Settings.tsx`, reached from the gear beside the pane's segmented control.

**Appearance.** The theme: follow the system, light, or dark. Stored under
`theme` and applied at once; following the system clears the key rather than
storing a word for it. `app.md` used to say a toggle would be localStorage in
an app whose data lives in `.yukifile/`, and that it belonged with library
settings. This is that.

**Plugins.** What is installed, ticked where the library runs it, with the
directory under each. `enabled` and `running` differ until the next open — a
registry is loaded once and every panel on screen was arbitrated against it —
and the caption says so beside any plugin where they do. **Save plugin list**
writes `.yukifile/plugins.json`; **Run everything installed** removes it,
because an empty list would be a library that runs nothing, which is a
different choice. Directories that would not parse are shown with why.

**Mount order.** The one library-wide rule: which source a page shows first
when two plugins name the same field. Moved a row at a time, and every mount
is named on every write, since a mount left out would keep its old position
and sit somewhere nobody chose. Mounts are not created here; mounting is what
choosing a property does.

**Other settings.** What plugins asked the library to remember, as rows that
can be cleared, and a key and a value to set. The raw tool; a plugin will be
able to draw its own settings in time.

## Pins

Not on this page, on purpose. A pin is the per-object override of mount
order, and `architecture.md` keeps rules and choices apart: the rule is
visible here, and each choice is visible on the object it affects, next to
the value it changes, with an obvious way to undo it. `SourceList` draws a
**Prefer** button beside each source of a shared field and **pinned · Unpin**
beside the one chosen; the pin is a value under `@pin/<field>`, written like
any other edit, and `object.flat` reports it as `pins` so the page can draw
it.
