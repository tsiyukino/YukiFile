# What organising a real VRChat library taught us

Notes from sorting 1518 files / 174 products by hand on 2026-09-01. Written
down because the same problems will come back when we automate any of this, and
because a future prompt for AI-assisted organising should start from these
rather than rediscovering them.

Everything here was observed in the library, not assumed.

## Where the metadata actually is

Filenames are the weakest signal. Better ones, in rough order of reliability:

**Vendor folder inside the package.** Unitypackages are gzipped tars; each
entry has a `pathname` file giving its original Unity path. The second segment
is almost always the vendor: `Assets/[meron-farm]/mochi-bob/...`. This worked
for 93 of 174 products with no network access at all. Searching the folder name
`mochi_bob1.0` found nothing; searching `meron-farm mochi bob` found the
product immediately.

**Per-avatar filenames.** Multi-avatar products ship one file per base, and the
base name is in the filename: `VEILWORKS_AWK_Lapwing_v1.0.0.zip`,
`Kikyo_Cross_Maid.zip`, `DaystarAndTwilight_Manuka_V1.0.zip`. This is how you
learn which variants are actually owned, which the shop page cannot tell you.

**License PDFs.** VN3 is a standard license template in this scene and its
first line is the product name. `黒猫弐号3Dモデル` was only recoverable this way.

**Promo images.** Authors print their shop URL on the artwork. One product's
cover image had `https://no39.booth.pm/` rendered into it.

**Readmes, after fixing encoding.** Several are Shift-JIS and look like
mojibake (`ùÿùpïKû±.txt`, `偼傑偺偟偡`). Decoded, they carry product names and
author contacts. Treat mojibake as data that needs decoding, not as noise.

**Existing .url files.** Present but sparse — 52 files, of which only about six
pointed at the product itself.

## Traps

**A bundled dependency is not the product.** Twelve packages ship lilToon or
Poiyomi inside them. A Santa outfit contained 23 files matching
`Assets/**/Editor/*.cs`, all of them lilToon's shader inspector. Any rule that
reads "has editor scripts, therefore is a tool" will misfile these. Strip known
vendor namespaces — lilToon, Poiyomi, VRCSDK, Modular Avatar, VRCFury, Thry —
before judging anything.

**A README's Booth link is often a dependency, not the product.**
`booth.pm/ja/items/3087170` appears in seven unrelated products. It is lilToon.
Scraping URLs naively labels seven products as a shader.

**Short avatar names collide with English words.** Matching `sio` as a
substring hits "Expre**sio**ns". `moe`, `rue`, `lime`, `anon`, `sen`, `rei`
have the same problem. Tokenise on non-alphanumerics and camelCase boundaries
before matching, and require extra evidence for short names. Naive substring
matching reported 53 multi-avatar packages; token matching found 35.

**Compatibility counts do not indicate genericness.** An early rule assumed
that hitting many avatar names meant "universal tool". It is the opposite:
AFK animations, expressions and gestures touch bones and blendshapes, so they
are strictly per-avatar and ship many variants. `VRSuya_AFK` matched 17 avatars
precisely because it is not generic. Genericness follows from what a thing is,
not from a count.

**Unextracted archives are invisible, not empty.** 103 zips were never
unpacked, 54 of them containing unitypackages. Reading them in memory
(zip → gzip → tar → manifest) recovered 8406 asset paths and took one product
from "no avatars detected" to 25. Any scanner that only looks at loose files is
blind to a third of this library.

**Folder names lie about their role.** `Texture/` is sometimes a bucket of
loose PNGs belonging to its parent, and sometimes a category folder holding
eighteen separate products. Excluding directories by name dropped all eighteen
silently. Decide by content — does it hold loose files or product-like
subdirectories — never by name. This mistake was made twice.

**Naming is inconsistent within one library.** `Clothes` / `Cloths` / `CLOTHS`,
`Texture` / `TEXTURE` / `TEXTURES` all appear.

## Structural facts about this domain

A product maps to exactly one folder or file. Products do not span folders. If
the same series appears in three places, that is three products, not one
scattered product.

Packaging varies by author and only affects import effort. Some ship one
unitypackage containing shared materials plus every avatar's meshes — one
import. Some split materials from bodies — two imports. Some, when you buy a
single avatar's fit, include the shared materials in each package, so buying
three fits gives you three copies of the same materials.

What a product supports and what you own are different sets. Booth lists all
compatible avatars; your disk shows which fits you bought. `Hollow` supports
25 avatars, of which one is present here. Reverse lookup has to answer from
what is owned.

Roughly a third of archives are redundant — 43 zips had an extracted sibling
folder of the same name.

MochiFitter uses a star topology through a template, not pairwise conversions,
so N avatars need N profiles rather than N². Profiles are distributed by the
avatar shops, not by MochiFitter's author. Direction matters and is visible in
the files: five profiles ship both `X_to_template` and `template_to_X`, while
YUGIMIYO ships only the forward direction, meaning outfits can be moved onto it
but not off it.

Sources are not all Booth. Gumroad, GitHub/VPM, geekjack, a Discord handle in a
readme, and free public distributions all appear. A source field with a `booth_url`
shape cannot hold these; it needs a type and a value.

## Search technique

Product name plus `booth` or `vrc`, nothing else. Adding avatar names, Japanese
category words or `対応` buries the exact match under category pages. When the
folder name fails, get the real product name out of the package first — from
the vendor path, a license PDF or a promo image — then search that.

Booth's own pages are unreliable to fetch directly; `/ja/` URLs frequently drop
the connection where `/en/` works, and sometimes neither does. Search results
carry enough (title, vendor, price, avatar count) for cataloguing.

## What stayed unidentified

Five of 174, after exhausting both file contents and search: two texture packs
with nothing but PNGs, a set of per-avatar packages with no vendor path, an
accessory with only an FBX and a material, and one RAR that could not be
opened. These have no source information anywhere in the files. Recording them
as unknown is correct; inventing plausible sources is not.
