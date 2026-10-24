# The application

How the pieces become something that runs.

Until this layer the project built and tested but had no entry point. There is
one now: a Tauri binary that opens a library, loads plugins, and points a
webview at a React frontend.

## Startup

`src-tauri/src/main.rs`

```
library_root()  → the first argument, or the working directory
open_library()  → .yukifile/library.db, created on first run
load_plugins()  → discover::in_directory, then Registry::load
register_commands!(builder).run(...)
```

Both pieces of state — the `Library` and the `Registry` — are handed to Tauri
with `manage`, which is how the annotated commands receive them.

### The two failure modes stay apart

A plugin directory that will not parse is **reported and skipped**. A set of
plugins that do not satisfy each other **refuses to start**.

That is `discover` and `Registry::load` drawing the line; `main.rs` only has to
respect it. Folding them together would let a leftover folder stop the
application, or an unsatisfied dependency pass quietly into a library where
some objects have panels and others do not.

### Where plugins are found

Beside the executable if that directory exists, otherwise the repository's
`plugins/`. The fallback keeps `cargo run` working without a build step that
copies plugins around.

## Configuration

`src-tauri/tauri.conf.json`

`dragDropEnabled` is **false**, which is not a default: Tauri's native
drag-and-drop has to be off for HTML5 drag-and-drop to work on Windows, and a
file manager wants the HTML5 kind.

The config is plain JSON rather than JSON5, so it carries no comments — JSON5
needs a Cargo feature, which is not worth adding for the sake of annotations
that belong here anyway.

## Frontend

| file | does |
|------|------|
| `index.html` | the mount point |
| `src/main.tsx` | mounts `App` inside Primer's `ThemeProvider` |
| `src/ui/theme.ts` | follows the operating system's colour mode |
| `src/ui/invoke.ts` | the only file that imports `@tauri-apps/api` |
| `src/ui/App.tsx` | the shell |
| `src/ui/problem.ts` | a thrown value in words, for every screen that shows one |

### The shell

A pane on the left and a page on the right.

The page is the thumbnail grid whenever nothing else is on it
([grid.md](grid.md)). Choosing a card shows that object, with **Back** and
**Forget** above it. The page can also show the add flow, while something on
disk is being made into an object; a change set, while one is being reviewed;
or a term, with everything that points at it ([term-page.md](term-page.md)).

The pane lists the other ways in: what the disk has (`DiskBrowser`), the
library's vocabularies (`TermList`), or what is waiting to be reviewed
(`ReviewList`), switched with a segmented control. Its Library segment lists
only the count, since the grid is the listing, and selecting it is the way back
to the grid from any page. The Disk pane shows directories as they sit, where
the grid shows objects as a plugin grouped them; which finds the thing a person
is thinking of depends on what they remember about it. See
[disk-browser.md](disk-browser.md). Review carries a count in its label, so a
scan that left something to decide is noticed without opening it. See
[review.md](review.md).

A gear beside the segmented control opens the settings page in place of
whatever the page was showing ([settings.md](settings.md)).

Under the plugins' library actions sit the shell's own **Rescan**, which
brings locations back in line with the disk and asks about what it could not
prove (`bridge.md`, *bridge::rescan*), and **Import…** and **Export…**, the
library in and out of a document through the operating system's dialogs
(`contract.md`, *Export*). The dialogs are the second thing `invoke.ts`
supplies, and for the same reason it supplies the first.

The shell holds two API objects. `api` is built from the allowlist and is what
every panel, viewer and form is handed. `app` is built from `APP_ONLY` and
reaches only the shell's own screens: a form returns values, and `app` is what
writes them. Keeping them as two values rather than one with more methods is
what makes "a plugin cannot write" a thing the type system says.

### One door to the runtime

`plugin-host/commands.ts` takes an injected `Invoke` so panels and the host are
testable without a running app. That holds only while there is one supplier, so
`src/ui/isolation.test.ts` fails if any other file imports `@tauri-apps` — the
same rule the Rust side keeps with `boundary.rs`, enforced the same way.

The test also asserts that `invoke.ts` still imports Tauri. Without that,
renaming the supplier would make the check vacuous: nothing would be exempt,
nothing would import Tauri, and it would pass while proving nothing.

### Theme follows the OS

`2026-09-01_ui-primer-not-github-clone.md` says light and dark are both
first-class. `useColorMode` subscribes to `prefers-color-scheme` rather than
reading it once, because a system that switches at sunset would otherwise
leave the window in yesterday's theme.

The toggle is a library setting, `theme`, on the settings page
([settings.md](settings.md)). `main.tsx` reads it once at startup and the
page changes it live; `system`, the default, is what following the OS always
meant. Stored in the library's own table rather than `localStorage`, so
copying the library copies the choice.

### Primer v38 removed `sx` and `Box`

Layout comes from `Stack` with named spacing tokens (`normal`, `condensed`),
not pixel values. There is no supported escape hatch for arbitrary spacing,
which is the design system working: two visual registers held together by
shared tokens was the decision, and bypassing the tokens is how they drift.

## Logging

`tauri-plugin-log`, writing to three places: the terminal, a file, and the
webview console. The file is the one that matters — three of the bugs found on
the first real runs were diagnosed by guessing from a screenshot, and a log to
send is what replaces the guessing.

Windows: `%LOCALAPPDATA%pp.yukifile\logs\yukifile.log`

Frontend command failures go through `invoke.ts` into the same file, so a
panel's complaint sits beside the command it called. The error is rethrown
untouched: callers switch on the tag, and swallowing it would turn a refusal
into a silence.

### Startup lines are logged from inside `setup`

The plugin attaches its logger in its own setup hook, which runs during
`run()`. Anything logged before that reaches a logger that does not exist and
vanishes — registering the plugin earlier does not help, because registration
is not attachment.

So `load_plugins` carries its skipped list out rather than logging it, and
startup reports from inside `setup`. That ordering was wrong twice before the
log file was checked, which is the argument for checking it: a logging setup
that looks installed and records nothing reads exactly like one that works.

`log:default` is granted in `capabilities/default.json`. Tauri 2 gates plugin
access per window, so the frontend call is denied without it.

## Building

```bash
npm run dev              # vite on 5173, then the window
npm run dev:lib -- path  # the same, opening a specific library
npm run build            # vite build, then the release binary
```

`cargo run` on its own is **not** enough during development: it starts the
binary without Vite, and the window points at a dev server that is not there.
`tauri dev` runs `beforeDevCommand` first, which is what starts Vite.

### Which library opens

The first argument, or the working directory — except when the working
directory is a source tree, which is what `tauri dev` gives you. Scanning that
would pull in `target/` and `node_modules/`, several gigabytes of build output,
so a scratch library under `target/` opens instead and the reason goes to
stderr.

Opening something rather than refusing to start is deliberate: a GUI that exits
with a message on stderr has, from where the user is sitting, done nothing at
all.

Vite uses `strictPort`, so a busy 5173 fails at startup instead of moving to
another port and leaving the window pointed at nothing.

`src-tauri/icons/icon.ico` is a placeholder generated at 32×32. Windows
resource compilation requires one; it is not a design.
