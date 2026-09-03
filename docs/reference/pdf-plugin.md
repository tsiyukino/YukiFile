# The PDF plugin

The second built-in, and the first consumer of the viewer slot. `viewersFor`
was written at layer 4 with tests and had never run against anything real.

## What it declares

```json
{
  "id": "yukifile.pdf",
  "contributes": {
    "properties": ["pdf"],
    "file_types": { "pdf": ["pdf"] },
    "panels":     { "pdf": "./panel" },
    "viewers":    { "pdf": "./viewer" }
  }
}
```

Both slots, which is what shows they are independent: the panel says where the
document is, the viewer draws it, and neither knows about the other.

## Presentation belongs to the host

`src/ui/Viewer.tsx` picks the region; the plugin renders into it. A viewer
receives `api`, `objectId`, `property` and `instance` — nothing that says
whether it is embedded or covering the window, and a test asserts that the
prop list stays that short.

Without that, a plugin would start branching on its own extent and presentation
would stop being a host decision. v1 offers embedded and covering; separate
windows and tabs are deferred and need no plugin change when they arrive.

More than one viewer on an object is normal, so the host offers a choice rather
than picking. Mount order supplies the default only.

## Rendering a file it cannot read

`api.fileUrl(path)` returns a URL, not contents. pdf.js fetches it through the
webview and the document goes from disk to a canvas without passing through
plugin JavaScript.

See [the decision](../decisions/2026-09-03_a-viewer-gets-a-url-not-bytes.md) for
why bytes would have been the wrong shape, and for the limit this does not
close: grants accumulate until the application restarts.

## pdf.js loads when a PDF is opened

The import sits inside the effect rather than at the top of the file, so the
two megabytes of worker land in their own chunk and load when somebody opens a
document. A viewer nobody opened should cost nothing.

The loading task is destroyed on unmount. `PDFDocumentProxy` has no `destroy`
of its own — the task owns the worker — so releasing the task is what frees the
memory.

## The split that makes it testable

`pdf.ts` decides, `viewer.tsx` and `panel.tsx` draw. Which location is the PDF,
which page is in range, what a refusal reads as: all answerable without a DOM,
which is the same split the archive plugin uses.

`clampPage(1, 0)` returns 1 rather than 0. `getDocument` can report zero pages
before it has read the catalogue, and asking for page 0 is asking for a page
that does not exist.
