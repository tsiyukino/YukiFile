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
file, and which folders are products is decided **by content, never by name**:

- a folder that directly holds any file is a product, and nothing below it is
  an object — the forty textures inside an outfit are the outfit's;
- a folder that holds only folders is a grouping, holding each thing directly
  inside it through `contains`;
- a file outside any product folder is a product by itself;
- an empty folder is a thing somebody made, not a grouping.

The rule reads an organised library (`Clothing/outfit/`) and an unorganised
one (`.AASHAREE/CLOTHS/AW KLASSIK MAID/`) the same way, at any depth. It has
to: before a library is organised nobody knows what any of it is, and the scan
is what makes it possible to find out. `vrc-lessons.md` is where the rule comes
from, and where its opposite — judging `Texture/` by its name — was made twice.

**Known cost.** A grouping with one stray file in it (a `readme.txt` beside the
product folders) reads as a product holding everything below it. The person
fixes that by hand; the alternative, deciding by the file's name, is the
mistake the lessons made.

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
it, and the price. Nothing is fetched; `docs.yml` says the network happens
when a person presses a button.

## The seed

`src-tauri/examples/seed.rs` turns `seed/` into a contract document:

```bash
cargo run --example seed -- ../seed seed.json
cargo run --example import -- <library-root> seed.json "seed"
```

174 products and 76 avatar terms with their spellings. Each product carries
both the path it was at and the path it was going to be moved to, so the
document matches whichever layout the library has; an import records no
locations, so the extra path costs nothing. A product with a Booth listing
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
