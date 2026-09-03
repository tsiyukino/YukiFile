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

There is deliberately no in-app toggle. A toggle is a stored preference, and
storing one before there is anywhere to put it means `localStorage` in a
desktop app whose data lives in `.yukifile/`. It belongs with library settings.

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
