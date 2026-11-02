# The application

How the pieces become something that runs.

Until this layer the project built and tested but had no entry point. There is
one now: a Tauri binary that opens a library, loads plugins, and points a
webview at a React frontend.

## Startup

`src-tauri/src/main.rs`

```
library_root()  → a switch made in the window, the first argument, the last library, or a scratch one
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
| `src/ui/App.tsx` | the shell: header, sidebar, page |
| `src/ui/app.css` | the shell's layout and every page's shared styles, on Primer's variables |
| `src/ui/LibraryMenu.tsx` | the header's Library menu: plugin actions, rescan, import, export |
| `src/ui/PageHead.tsx` | the heading every page but the grid shares |
| `src/ui/problem.ts` | a thrown value in words, for every screen that shows one |

### The shell

A header, a sidebar, and a page.

The header holds what applies everywhere. The search box searches the whole
library and takes the window to the grid; `/` reaches it from anywhere that
is not a text field. A **Review** button with a count appears while change
sets wait. The **Library** menu holds the plugins' library actions (a scan),
**Rescan disk…** in a dialog, and **Import from file…** and **Export to
file…** through the operating system's dialogs. What each did is reported in
a banner above the page. The gear opens settings.

The sidebar switches between four views: the grid, the disk, the
vocabularies and the change sets. Under the switch it holds what the current
view needs: the grid's filters ([grid.md](grid.md)), the term list
([term-page.md](term-page.md)), the sets awaiting review
([review.md](review.md)). The disk view needs nothing there; its browser is the
page ([disk-browser.md](disk-browser.md)).

Choosing an object anywhere shows its page over the view it came from, with
**Back** and **Forget** above it. The view is hidden, not unmounted, and its
scroll position is kept: Back returns to the same grouping, the same filters,
the same row. Where the grid has walked, how it is sorted, its filters and its
card size live in the shell for the same reason.

The card size is a library setting, `grid.card_size`, beside `theme`.

### Themes

`main.tsx` imports Primer's primitives: the light and dark theme files and
the size, space and type scales. Primer's components read every colour from
those CSS variables; without the files they fall back to the light values
they were compiled with, which is why the dark theme never appeared before the
files were imported. The colour mode is set on the document element as well
as on the provider, so the body and the scrollbars follow it.
`src/ui/app.css` lays out the shell on the same variables; a raw colour there
is a theme somebody forgot.

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

In order: a switch made from inside the window, a folder named as the first
argument, the library opened last, and otherwise a scratch library
(`src-tauri/src/libraries.rs`). A remembered library whose folder is gone, a
drive not plugged in, is passed over and stays on the list.

What was opened is remembered in `libraries.json` in the application's own
config directory (`%APPDATA%\yukifile` on Windows), not in any library: which
library a machine opens is a fact about the machine. The list keeps the last
eight.

The scratch library sits under `target/` when the working directory is a
source tree, which is what `tauri dev` gives you, and in the config directory
otherwise. The working directory itself is never opened: from a shortcut it is
often the install folder, and making that a library would write `.yukifile/`
into it. Opening something rather than refusing to start is deliberate: a GUI
that exits with a message on stderr has, from where the user is sitting, done
nothing at all.

### Choosing a library from the window

The library's name at the top left opens **Libraries**: the ones opened
before, each with **Open** and a button to forget it from the list, and **Open
another library…**, which asks the operating system for a folder. A folder
that has never been a library becomes one when opened. The three commands,
`library.recent`, `library.switch` and `library.recent.remove`, are the
application's own: a plugin that could switch libraries could point the window
at any folder on the machine.

Switching writes the choice down and restarts the process. Everything on
screen hangs off the opened library -- its connection, the plugins it
enables, the asset scope granted for its files -- and a restart replaces all
of it correctly by construction, where swapping it under a running window
would be a dozen places to get half right.

Vite uses `strictPort`, so a busy 5173 fails at startup instead of moving to
another port and leaving the window pointed at nothing.

`src-tauri/icons/icon.ico` is a placeholder generated at 32×32. Windows
resource compilation requires one; it is not a design.
