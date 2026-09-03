# A viewer is given a URL, not the file's bytes

Date: 2026-09-03
Status: accepted

## Context

The PDF plugin is the first viewer, and a viewer has to get at the document
somehow. The obvious command is `file.bytes`: give it a path, hand back the
contents.

## Why bytes is the wrong shape

`file.bytes` would let every installed plugin read every file in the library.
Path confinement still applies, so nothing outside the library root is
reachable — but inside it, everything is.

That matters more than it first looks, because plugins can also call
`import.propose`. A plugin that can read a file and can also submit a document
can encode what it read into what it proposes. Review catches a plugin
proposing an obviously wrong title; it does not catch a plugin proposing a
plausible one whose bytes happen to spell out a document it read. **Read access
plus any outbound channel is an exfiltration channel**, and the outbound channel
already exists by design.

## What other software does

Three shapes are in use:

- **Capability URLs.** The host hands out a restricted handle to one resource
  rather than its contents. Data flows through the browser into an `<img>`,
  `<video>` or renderer without passing through the extension's code.
- **Sandboxed viewers.** The viewer runs in its own frame with its own
  permissions, isolated from the extension host — VS Code's custom editors.
  Costs a cross-frame protocol.
- **Host renders, plugin describes.** Safest and least extensible: the viewer
  stops being an extension point.

## Decision

`file.url` returns a URL, granted per file.

Tauri's asset protocol starts with an **empty** scope. `file.url` resolves the
path against the library root the way every other command does, grants that one
file, and returns an `asset://` URL. pdf.js fetches it through the webview, so
the document goes from disk to a canvas without passing through plugin
JavaScript.

A plugin cannot guess a URL for a file it never asked about: an ungranted path
is refused by the protocol itself.

## What this does not solve

Grants accumulate for the life of the process. Tauri's scope has no revoke, so
a file viewed once stays reachable until the application restarts. A plugin
that recorded a URL could refetch it later in the same session.

That is a real limit, and it is written down rather than left to be discovered.
Closing it needs either a custom protocol handler with its own token table or
per-viewer frame isolation, and neither is a v1 question.

## Consequences

- `protocol-asset` is a Cargo feature and the CSP admits `asset:`.
- A plugin that genuinely needs bytes — parsing a custom format — has to do it
  in Rust behind a command, which is where heavy work already lives.
- The URL is percent-encoded whole. Library paths hold spaces and `#`, and a
  raw `#` truncates a URL at the fragment, so the viewer would ask for a file
  whose name stops early.
