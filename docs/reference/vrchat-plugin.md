# vrchat plugin

`plugins/vrchat/`

The plugin the whole design came out of, built last on purpose. The PDF and
paper plugins exposed defects in the extension points with almost no domain
knowledge in the way; this one carries a lot, and every rule in it is one
`seed/vrc-lessons.md` records the cost of getting wrong.

## What it contributes

```json
{
  "properties": ["vrchat", "booth"],
  "shared": ["title", "price", "url", "vendor"],
  "vocabularies": ["avatar"],
  "forms": { "vrchat": "./form", "booth": "./booth-form" },
  "panels": { "vrchat": "./panel", "booth": "./booth-panel" },
  "library_actions": ["scan products"]
}
```

`vrchat` is what a thing is in this library: a category, a vendor, which
avatars it fits. `booth` is where it was bought. They are separate properties
because a product can be sold on two shops and a shop can sell things that are
not VRChat assets; they ship in one plugin because the architecture's own
example does, and splitting them before a second shop exists would be
designing against nothing.

## Fields

| path | holds |
|------|-------|
| `vrchat#1/category` | `Clothing`, `Hair`, … — a string the person chose |
| `vrchat#1/vendor` | the shop or author; shared as `vendor` |
| `vrchat#1/status` | how the identification was made: `confirmed`, `vendor-from-package`, `NOT-FOUND` |
| `booth#1/item_id` | the listing's number, so two spellings of one URL compare equal |
| `booth#1/url` | the canonical page |
| `booth#1/price` | whole yen |
| `booth#1/title` | the shop's title; a source for the shared `title` |

Avatars are edges, not fields: `supports → avatar:manuka` is what the listing
says it fits, `owned` is what is on disk. The lessons are explicit that those
are different sets and reverse lookup answers from the second. The term page
is where the answer shows.

## The scan: what counts as a product

`productsFrom` in `vrchat.ts`, pure and tested. A product is one folder or one
file. What the scan cannot know is **where products begin**: a folder is a
category holding products or a product holding its own parts, and nothing in
the folder says which. The first version decided by content — a folder with
loose files is a product — and on the real library it made 800 objects of 174
products, because an unpacked package is a folder of folders.

Before anything else, the product's own evidence. A folder that directly holds
`Assets/`, `Packages/` or `ProjectSettings/`, or a model, prefab or material
file, is a Unity layout — an unpacked package or a project — and one thing,
whatever its depth or name. That is what the format is, not a judgement about
meaning. It is the rule VRCAL's scanner arrived at ("engine layouts and loose
model sources prove a product boundary"), and it is what lets
`Bases/Airi_Ver1.00/` be a product without anyone saying so. `Textures/` is
deliberately not evidence: a category can be called that.

Then the library says, through its setting `vrchat.grouping_depth`, which the
plugin reads with `setting.get` and the settings page shows:

| depth | groupings | a product is |
|-------|-----------|--------------|
| `1` (the default) | the top-level folders | anything directly inside one: `Clothing/outfit/` |
| `2` | two levels | anything at the third: `.LAPWING/Clothes/outfit/` |
| `0` | none | everything at the root |

Every folder down to the grouping depth is a grouping, holding each thing
directly inside it through `contains`. Everything directly below the last
grouping level is a product, whatever is inside it. A file at a grouping level
is a product too, since a file is never a grouping — which is what makes
`_Archive/` forty-two products. The walk reads one level more than the
groupings go and never a product's own parts.

That is a fact about how the person arranged their library, told once, rather
than a guess made per folder. A value that is not a small whole number reads
as one rather than refusing to scan; the settings page shows what is stored.

**Categories nest.** The seed library has `NSFW/BDSM/Accessory/`, and a depth
of one read `NSFW/BDSM` as a product holding 21 real ones. So a folder inside
a grouping whose name is one of the plugin's category names (`GROUPING_NAMES`:
the eleven categories plus `BDSM` and `BodyPart`) is a grouping too, at any
depth. That is a judgement by name, and it is allowed where `Texture/` was
not: the list is the person's own, and the question is "is this one of the
folders I sort into", not "what is inside this". A product would have to be
named exactly like a category to be misread, and only when it sits directly
in a grouping.

**The scan writes no values.** A folder's name is where a thing sits, not what
it is, and one library has `Clothes`, `Cloths` and `CLOTHS`. The category
comes by import or from a person. When the folder happens to be spelled like
one of the known categories, the form starts from it, and from nothing
otherwise.

The scan does not read inside anything, judge a folder by its name, or guess
an avatar from a filename. Each is a trap the lessons name; each is a later
rule with its own evidence.

## The forms

**VRChat**: a category, offered from the eleven the seed settled on and
accepting any, starting from the parent folder only when it is spelled like
one of them; and a vendor, free
text. The package panel lists the folders under `Assets/`, where a vendor's
name usually sits, and leaves the conclusion to the person.

**Booth**: a listing in any of the spellings people paste —
`booth.pm/ja/items/N`, `shop.booth.pm/items/N`, or the bare number — a price
in whole yen, and the shop's title. A URL that is not a Booth listing is
refused with its reason rather than dropped.

## The panels

**VRChat**: category and vendor on one line, the identification status when
there is one, and the avatars grouped by edge kind with their labels from the
vocabulary. **Booth**: the listing as a link, titled the way the shop titles
it, the shop, the price and the number, or a line saying it is not fetched
yet. Title, price, url, vendor and cover are shared fields, so they are read
from the object's sources attributed to this region (`listingValues`) as well
as its own fields; reading only the region once made the panel say "No
listing recorded." on every product that had one. When the shop is not the
vendor the files or a person gave, the panel says so and that the listing
number may be wrong. Nothing is fetched; `docs.yml` says the network happens
when a person decides.

## Fetch listing

The first thing in the application that reaches the network, and the first
object action. On a `booth` region, **fetch listing** asks Booth for the item
the region names — `item_id`, or the number out of `url` — at
`booth.pm/en/items/<id>.json`, reads the title, the price in whole yen, the
shop's name and the first image out of what comes back (`booth.ts`, tolerant
by design: a field the shop moves costs the field, not the fetch), has the
core store the picture as a cover, and proposes the lot under `booth#1`
through `import.propose`, with the listing's page as `url`. A value already
there that differs waits in a change set.

The picture is tried at its original size first, since a cover is kept at up
to 512 pixels, then at the 300-pixel size Booth serves for cards. A picture
that will not come is said in the result, with the reason. It was once
swallowed: Booth's pictures are on `booth.pximg.net`, which the manifest did
not name, so every fetch was refused its picture and reported success.

**The shop is checked against the vendor.** A listing number found in a
package's files can be the number of something the package credits; the seed
filed two Qrochairo Store outfits under another shop's item that way
(corrected in `seed/`). When the listing's shop is not the vendor the files or
a person gave, ignoring case, spaces and punctuation, the result says to check
the number; a press on one object still proposes the values, and the run over
the whole library leaves that product alone and names it.

The press is what lends the plugin the network, for `booth.pm`, `*.booth.pm`
and `booth.pximg.net` as the manifest names them. Nothing on the page reaches outside
until the button is pressed. The matching VRCAL does — scoring a filename
against candidates — is a later rule; this one only has to be right about a
listing whose number is already known.

## Fetch every listing

**Fetch booth listings**, a library action in the Library menu, presses
**fetch listing** for every Booth listing the library records and has not
fetched yet: each `booth` region with an `item_id` and no `cover` of its own.
One request at a time with a second between them, so the seed's 72 listings
are 72 polite requests rather than a burst. A listing that fails or says
nothing new is counted and passed over, and one whose shop is not the
object's vendor is left alone and named in the result.

`cover` is one of the plugin's shared fields, so the shop's picture is a
source of the object's cover like the person's own and the application's
finds: it outranks a find, and a person's own pick outranks it. A listing
counts as fetched once the shop's cover is among the object's cover sources.

It is also the plugin's one `automatic_actions` entry. Switched on in
settings, it runs by itself when the library opens and after every scan,
import or added object, so a product scanned in with a Booth number gets the
shop's picture as its cover without anyone pressing anything.

## Facets

`facets: ["category", "vendor"]`: the sidebar counts both and narrows the
grid by them, and every card says them under its name.

## The seed

`src-tauri/examples/seed.rs` turns `seed/` into a contract document:

```bash
cargo run --example seed -- ../seed seed.json to
cargo run --example import -- <library-root> seed.json "seed"
```

173 products and 76 avatar terms with their spellings. The third argument
picks the layout: `to` (the default) writes the path each product was going to
be moved to, `from` the path it was at. **One path, not both**: an import
records every path it is given as a location, and the first version wrote
both, which put 174 locations in the library that were not on disk and sent
every panel looking for them. The one product whose path is absolute — being
moved out to `World/` — is left out and counted. A product with a Booth listing
gets its title under `booth#1/title`; one identified from a license PDF or a
promo image gets a bare `title`, because that is what a bare field means. A
redundant zip becomes an `archived-as` edge, in both the old place and the
planned `_Archive/`, and the core skips whichever it does not hold.

**Scan first, then import.** The import matches objects by path and makes new
ones only where none matches; a scan afterwards would find the paths and make
objects of its own beside the imported ones. Run `scan products`, then the
import, and the 160 identified products land on the objects the scan made.
Importing twice changes nothing the second time.

## What is deliberately not here yet

Vendor from the package's folders, avatars from per-avatar filenames, Booth
fetch, the thumbnail grid. Each has an entry in the lessons, and each arrives
as its own rule with its own test rather than as part of the first version.
