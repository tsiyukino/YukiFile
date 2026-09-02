# UI ownership follows properties

Date: 2026-09-02
Status: accepted — direction; v1 implements a subset, see below

## Context

`2026-09-01_viewer-extension-point.md` settled one case: a viewer renders into a
region and does not know where that region is. That answer does not generalise
on its own. A markdown preview wants to sit beside the markdown editor. A price
comparison wants to appear among the shop panels. A histogram wants to attach to
an image viewer. None of them is served by "the host decides everything", and
all of them break if plugins declare screen positions and fight over them.

The failed framing was positional. Two plugins both saying "put me on the right"
cannot be arbitrated; whoever loads last wins, which is not a decision anyone
made.

## The reframe

A plugin's reach is already scoped by property. It contributes properties,
declares dependencies on properties, and applies to an object only if that
object carries the property. Extending the same scoping to the interface is not
a new mechanism:

> **A plugin's UI belongs to the property it is scoped to. The framework decides
> where that property's region goes; the plugin decides what is inside it.**

The unanswerable question ("where on screen?") becomes an answered one ("which
property?"), and ordering falls out of mount order, which already exists.

## Decision

### Contributions are (property, slot) pairs

```
(booth, panel)   a panel in Booth's region of the detail page
(booth, action)  "Open on Booth" in the context menu
(booth, column)  a price column in the list
(pdf,  viewer)   the reader
```

One visibility rule covers all of them: the contribution appears if the object
carries the property. The context menu needs no separate logic from panels.

### Requiring a property is the ticket into its region

A price-comparison plugin that `requires` both `booth` and `gumroad` may place a
panel in either region. A plugin that requires neither may not. The permission
model and the dependency declaration are the same statement, checked at plugin
load rather than by review.

### A plugin may own the whole object page

The framework does not impose a mandatory header. A VRChat asset page and a
paper page have little in common, and a framework-defined "universal top
section" assumes a shape that does not exist.

An object's page is drawn by one plugin — the owner — which lays it out freely,
optionally using framework components (`ObjectCover`, `ObjectTitle`,
`ObjectActions`) and optionally yielding space to other plugins' regions. If no
plugin owns the page, the framework draws its default layout.

Ownership is a **per-object** choice, set at import and changeable later, stored
as `objects.primary_property`. It is not derived from mount order: whether a PDF
is a prop an avatar holds or a document to read is something only the user
knows, and mount order is library-wide where this decision is per object.

### Actions follow properties, never layout

An object carrying `pdf` offers the PDF plugin's actions no matter who draws the
page. Action entry points — context menu, command palette, keyboard — live
outside the layout, so full layout ownership costs the user nothing.

This is what makes "the VRChat plugin owns the page, but I want to read the PDF"
a non-problem: right-click, open in the reader. No layout switching, and no
mandatory slot reserved inside every plugin's layout.

Switching the owner is itself an action, offered by the framework, temporarily
or permanently.

### The context menu is structured by plugins

A plugin decides whether its actions sit at the menu root or gather under a
submenu, as applications do on Windows. The framework does not impose a shape:
on a PDF object, "Open in reader" belongs at the root, and forcing it into a
submenu would be worse.

Guidance rather than enforcement — one root item per plugin, the rest in a
submenu — with the framework folding later plugins into "More" if a menu grows
past a threshold. Enforcement would block the reasonable case to prevent the
inconsiderate one.

### Grids and lists are not ownable

The detail page may differ per object. The grid may not.

The grid exists to be scanned, and
`2026-09-01_ui-primer-not-github-clone.md` records that not being able to tell
what anything was without opening it is the original problem. Tiles drawn
differently per object defeat scanning outright. The framework draws the grid;
plugins contribute columns and badges.

### Nesting is one level deep

A viewer may open regions around itself for plugins that depend on it — a
histogram beside an image viewer. Those regions do not nest further. No real
requirement asks for more, and each level multiplies the arbitration, collapse
state and focus-order work.

## What v1 implements

v1 ships the framework's default layout, property regions, and the panel,
action and viewer slots. It does **not** ship layout ownership, and it does not
publish the component library.

The PDF plugin uses the default layout with a panel, a viewer and actions. That
exercises the property-scoped model without requiring `@yukifile/ui` to be a
public API before there is a second plugin to design it against — the same
judgement `2026-09-01_v1-scope-and-build-order.md` applies to unitypackage
support. A component library published now would be designed against one
consumer and frozen by the second.

See `2026-09-02_v1-scope-revised.md`.

## Consequences

Ordering needs no new mechanism: property regions and panels order by mount
order, like everything else
(`2026-09-02_mount-order-and-pins.md`).

The default layout must render **any** object — unknown properties, no
properties, an owner plugin that failed to load, an owner plugin that throws
mid-render. That is an error boundary and four tests, not a design problem, but
it is load-bearing: it is the fallback that makes full ownership safe to allow.

An owner plugin may yield no space to others. That is permitted, since the owner
knows what the page should be, but the framework keeps an escape hatch — showing
all plugin panels, or reverting to the default layout — so a user is never
stranded inside one author's judgement about what matters.

A detail page with many properties has many regions and grows long. That is the
price of zero positional conflict, and the answer is a UI one — collapsing,
tabs, "more" — to be designed when the views are built and there is something
real to look at.
