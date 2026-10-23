# unitypackage plugin

`plugins/unitypackage/`

The consumer the core's package reader was waiting for, and the built-in that
registers the file type the core is not allowed to know.

## What it contributes

```json
{
  "properties": ["unitypackage"],
  "file_types": { "unitypackage": ["unitypackage"] },
  "panels": { "unitypackage": "./panel" }
}
```

A `.unitypackage` brings the `unitypackage` property, which is factual: it is
one whether or not anybody says so. The panel draws in its region.

## The panel

`summarise` in `panel.ts` is pure and tested without a DOM: the asset and
folder counts, the bytes, how many assets carry a preview, the first forty
paths, and **the folders directly under `Assets/`**, each once in order of
first appearance.

That last line is where a vendor's name usually sits —
`Assets/[meron-farm]/mochi-bob/...` — and it is what a person searches a shop
with. The panel shows the folders and does not call any of them the vendor.
`seed/vrc-lessons.md` lists what goes wrong when that conclusion is drawn
carelessly (lilToon ships inside twelve products), and drawing it is the
VRChat plugin's job.

The panel reads the object's first file location through `object.flat` and
hands it to `unitypackage.list`. A refusal becomes a sentence rather than a
thrown error, so an unreadable package is a fact about that object and not a
failure of the page.

## Packages inside zips

`unitypackage.list` takes a `member` so a package stored in a zip can be read
without unpacking the zip. This plugin does not use it yet: the archive panel
lists the zip, and the VRChat plugin is the one with a reason to look inside.
