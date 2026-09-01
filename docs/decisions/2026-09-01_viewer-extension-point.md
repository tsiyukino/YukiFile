# A viewer renders into a region and does not know where that region is

Date: 2026-09-01
Status: accepted

## Context

The PDF plugin is the first viewer consumer, which forced the viewer extension
point to be designed. Four presentations were on the table: embedded in the
main window, filling the main window, in a second window, and browser-style
tabs.

The question looked like "how many kinds of viewer should the API support".
That was the wrong question.

## The four are not four

They decompose into two orthogonal dimensions plus one thing that is not a
viewer concern at all:

| presentation        | what it actually is                    |
|---------------------|----------------------------------------|
| embedded            | window = main, extent = inline         |
| full-window         | window = main, extent = covering       |
| second window       | window = separate                      |
| browser-style tabs  | a navigation model, not a presentation |

Tabs answer "three documents are open, how do I switch between them". That
question exists identically under all three presentations and has the same
answer in each. Listing it alongside the others invites designing a tab-shaped
viewer, which is not a thing.

## Decision

A viewer contributes one capability:

> given an object and a rectangular region, render it.

The plugin does not know whether that region is embedded, covering the window,
or in a separate window. Presentation is a host decision made at runtime, not
a plugin declaration.

There is no `"mode": "window"` field in the manifest, and the words "tab" and
"window" do not appear in the plugin API.

v1 implements two presentations: embedded and full-window. Separate windows and
tabs are deferred.

## Why presentation belongs to the host

If plugins declare their presentation, every mode has to be enumerated now,
adding one later is a breaking change, and each plugin author has to make a
decision that belongs to the host. Worse, the host loses the ability to offer
the choice to the user, because the plugin has already made it.

With presentation on the host side, "how many presentations exist" stops being
an extension point question and becomes a UI implementation question, which can
be answered incrementally. Adding separate windows or tabs later changes no
plugin code.

The architecture describes viewers as "a PDF reader opening in a tab or
window". That describes behaviour a user sees, not a shape the API must have.
Both behaviours are reachable under this decision without either word entering
the API.

## Why embedded and full-window first

They share a React tree, a state store and a Tauri instance; the difference is
the container's CSS and one boolean. The second is nearly free once the first
exists. Embedded is also the common case — opening a PDF to glance at it and
close it should not seize the whole window.

Separate windows are deferred because they are the only one of the three with
real engineering cost: a second React root, cross-window state synchronisation,
window lifecycle and teardown. None of that cost is viewer-extension-point
cost — it is Tauri multi-window cost — so deferring it does not degrade the
extension point's design.

Tabs are deferred because v1 has one viewer plugin and no established need to
hold several documents open at once. Tabs live in the host's navigation layer
when they arrive, and viewer plugins will not change.

## Capability declaration

A viewer may eventually need to declare requirements the host cannot infer —
a minimum useful width, for instance. That constrains size, not position, so it
does not conflict with this decision. It is not in v1: with one viewer plugin,
any such field would be a guess.

## Consequences

`slots.ts` arbitrates three contribution kinds — panels, columns and viewers —
and the viewer kind carries no presentation dimension, so it is no more complex
than the other two.

`ViewerHost.tsx` needs exactly two inputs: which plugin's viewer to render, and
whether it covers the window.
