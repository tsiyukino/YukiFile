# Mount order for rules, pins for choices

Date: 2026-09-02
Status: accepted

## Context

Mount order started as the fallback order for flattening. It then turned out to
answer several other questions that all reduce to "which source do I trust
more": which panel appears above which, which cover is shown, which plugin's
detail layout is offered by default.

Having one control answer all of them is deliberate. A user who moves Gumroad
above Booth gets the Gumroad title, the Gumroad cover, and the Gumroad panel on
top — one action, one mental model, no settings screen where the same
preference is expressed four times and can disagree with itself.

The problem is that mount order is a **library-wide** setting, and two of the
questions it answers are **per-object**.

## The break

Booth ranks above Gumroad, so every object shows its Booth cover. For one
product the Booth promo image is poor and the Gumroad one is good. The user
wants to change that one object.

They cannot, except by reordering the whole library and affecting 173 other
objects.

Covers are not a marginal case here. `2026-09-01_ui-primer-not-github-clone.md`
states that thumbnails are load-bearing and that recognition through them is the
original problem this application exists to solve. A cover the user cannot
correct is a defect in the main feature.

## Why not per-field priority

The obvious fix is configurable priority per field: "for `cover`, prefer
Gumroad". `2026-09-01_object-property-model.md` already refused this, and the
reason still holds:

> Per-field priority is the kind of setting nobody remembers configuring and
> nobody can debug.

A rule set once in a preferences pane, invisible at the point where it takes
effect, explaining nothing about why this object looks different from its
neighbour.

## Decision

Keep mount order as the only **rule**, and add **pins** for individual choices.

| | shape | visibility |
|---|---|---|
| mount order | a rule: "Gumroad before Booth, everywhere" | a list in settings |
| pin | a choice: "this object's cover is the Gumroad one" | on the object, where it applies |

A pin is stored as a value on the object:

```
42/@pin/cover   "gumroad#1"
```

It names a source for one field on one object. Resolution checks pins before
mount order; everything else is unchanged.

The `@pin` namespace is reserved the same way core properties are, so no plugin
can contribute pins on a user's behalf.

## Why pins are debuggable where priority rules are not

A pin is visible where it acts. The detail page shows "pinned to Gumroad —
reset", so the user sees the decision, sees that they made it, and can undo it
without finding a settings pane. It applies to one object, so a wrong pin is a
small, local wrongness rather than a rule quietly reshaping the library.

The distinction generalises: a rule the user sets once and then cannot see is
expensive; a choice they make in context and can see afterwards is cheap. That
is why one is refused and the other admitted, despite both being "override the
default order".

## What mount order still decides

| decides | scope | overridable per object |
|---|---|---|
| source order for shared fields | library | yes, by pin |
| cover selection | library | yes, by pin |
| panel order on the detail page | library | no |
| default owner of an object's layout | library | yes, by the object's `primary_property` |

Panel order stays library-wide with no override. Nothing in the seed data
suggests a user would want panel order to differ per object, and adding an
override with no demand for it would be the per-field-priority mistake in
another costume.

## Consequences

Resolution gains one step before mount order. It stays a pure function: pins
arrive as part of the object's values, like any other value.

Pins survive re-fetching. A user who pinned the Gumroad cover keeps it when
Booth is fetched again, which is the same guarantee namespaced paths give for
titles: a decision already made is not re-litigated by a network call.

A pin naming a source that no longer exists — the plugin was uninstalled, the
instance unmounted — is ignored and falls through to mount order. It is not an
error and it is not deleted, so reinstalling the plugin restores the choice.
This matches how unmounted values behave in flattening.
