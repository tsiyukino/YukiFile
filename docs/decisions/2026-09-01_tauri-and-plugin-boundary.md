# Tauri, with TypeScript plugins over a Rust core

Date: 2026-09-01
Status: accepted

## Context

The application has to stay responsive on libraries of tens of gigabytes and
thousands of files, and it has to accept plugins written by other people. Those
two goals pull in opposite directions: native code is fast, scripting is
approachable.

Measured on the real library during the manual cleanup:

| task                                    | observed          |
|-----------------------------------------|-------------------|
| parse 206 unitypackage manifests        | Python: timed out at 2 min |
| read 103 zips without extracting        | Python: ~40 s     |
| walk 1518 files                         | negligible either way |

The unitypackage number is the one that matters. Those are gzipped tars, and
the library will only grow.

## Decision

Tauri. Rust backend, TypeScript and React frontend, SQLite storage.

Plugins are TypeScript. Heavy work is not exposed to plugins as something they
implement — scanning, hashing, archive reading, PDF text extraction and all
database access are Rust commands in the core that plugins call.

Plugins needing genuinely custom heavy computation can ship WASM. Native
dynamic loading of Rust plugins is not offered: Rust has no stable ABI, so
`.dll` plugins break whenever the compiler version moves.

## Why not Electron

Frontend performance is identical — both render JavaScript in Chromium or
WebView2, so plugin panels behave the same either way. The differences are all
on the other side: gzip and filesystem work is roughly an order of magnitude
faster in parallel Rust, and baseline memory is about 50 MB against 150–300 MB
for a bundled Chromium.

Since plugin authors write TypeScript under either choice, Electron's usual
advantage does not apply here.

## Consequences

Plugin authors write TypeScript and call fast primitives. They do not need
Rust, and they cannot accidentally make scanning slow, because they are not the
ones scanning.

Core development is slower than it would be in a single language. That is a
one-time cost against a permanent performance property.

The first version ships real plugin loading rather than a compile-time
registry. Building the VRChat and paper modules as actual plugins against the
same API is what validates the API; a registry now would mean designing the
plugin interface later, against a codebase already shaped around not having
one.

Built-in modules (`folder`, `file`, `archive`, `pdf`, `docx`, `image`) get no
privileges and use the public contribution API. If a built-in needs a special
case in the core, that is a defect in the extension point, and it gets fixed
before third parties depend on it.

UI extension points in the first version are detail panels, full-screen viewers
and list columns. Layout itself is not extensible yet: with only six built-in
modules to design against, layout extension points would mostly be speculation.
