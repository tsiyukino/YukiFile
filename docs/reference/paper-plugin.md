# paper plugin

`plugins/paper/`

The first semantic property anything ships, and the first consumer of the
`forms` slot.

## Why it exists

[architecture.md](../explanation/architecture.md) splits properties in two.
Factual ones are attached because they are observably true — a `.pdf` is a pdf.
Semantic ones are attached by a person, because the software cannot tell a
research dataset from a VRChat outfit by looking at extensions, and pretending
otherwise produces confident wrong answers that are worse than blanks.

Before this plugin every built-in declared only factual properties, so the
picker had nothing to offer. That was honest rather than broken: nothing
claimed to know what a paper was.

## What it contributes

```json
{
  "properties": ["paper"],
  "shared": ["title"],
  "forms": { "paper": "./form" },
  "panels": { "paper": "./panel" },
  "requires": { "properties": ["pdf"] }
}
```

`requires: ["pdf"]` is the layering the architecture describes — a paper can
offer DOI lookup because `pdf` already provides text extraction — and it is also
the ticket into `pdf`'s region, since requiring a property is what permits
contributing to it.

`title` is shared, so a paper's title and a shop's title become two sources for
one field rather than two unrelated fields.

## The form

The second step of the picker. Knowing that a paper has a DOI is this plugin's
business: nothing in `bridge::objects` mentions one, and the values the form
returns reach it as an opaque map.

It hands values over through `onDone` and never writes. A plugin with a direct
write would route around the review change sets exist for, which is why writing
is on `APP_ONLY`.

**Leaving both fields blank is allowed.** The property was still chosen, and
`store::carried` keeps that decision whether or not it has values.

### A DOI is stored in one form

`doi:10.1000/x`, `https://doi.org/10.1000/x` and `10.1000/x` name one document.
Storing them as typed would make two copies of one paper look like two papers to
anything comparing the field.

The prefix is lowercased and the suffix is not: the registrant code is
case-insensitive by the DOI handbook, and the suffix is not guaranteed to be, so
lowercasing the whole string would change what some publishers issue.

A DOI that does not parse is **refused rather than dropped**. Somebody who typed
one and got an object without it would have no idea why.

### The title is a guess, offered

`titleFrom` drops the extension and turns underscores into spaces. It does not
look for an author or a year — `seed/vrc-lessons.md` records what guessing costs,
and a filename is what the person already calls the thing.

**Underscores separate; hyphens join.** The rule is not symmetric, and the first
version wrote it as though it were. Counted over the seed library: 318 filenames
hold an underscore and 34 hold a hyphen. The underscores are separators
(`Predicting_Oral_Disintegrating_Tablet_Formulations`); the hyphens are joiners —
`small-molecule` is a compound adjective, `CS-Chem` a course, `Intro-v2` a
version.

Replacing them turned a paper about small-molecule solubility into one about
"small molecule solubility", with nothing on screen to say it had happened. A
filename that really does use hyphens as separators keeps them, which is visible
and one keystroke to fix.

## The panel

Shows the DOI as a link, because a DOI's whole purpose is to resolve.

Deliberately nothing else. A citation, an abstract and an author list all want
the network, and `docs.yml` says that happens when the user presses a button
rather than when a page draws.

The region draws whether or not a DOI is recorded: a paper somebody added
without one is still a paper, and the blank is what says the field is waiting.
