# The object page

What a person sees when they open an object, and where plugin panels land.

v1 ships no layout ownership (`2026-09-02_v1-scope-revised.md`), so this is
what every object gets. A plugin contributes into it; nothing replaces it.

## What meets here

Three answers arrive from three places, and the page decides none of them:

| from | says |
|------|------|
| `object.flat` | what the object holds, resolved into shared fields and regions |
| `slots.panelsFor` | which panels belong to it, in mount order |
| `loader.loadAll` | which of those modules actually came back |

The page's own job is the small part: headline first, then the remaining shared
fields, then one region per property instance in the order the object gives
them — which is mount order, sorted in the bridge and not re-derived here.

## Sources, not winners, made visible

A product on two shops has three titles and all three are true. `SourceList`
shows the first and puts the rest one click away, each attributed to the
property instance it came from (`booth#1`) or to "entered here" for a bare
field.

Hiding the others would make the model invisible exactly where somebody needs
it: the moment they wonder why the title is not what they typed is the moment
the answer has to be reachable.

## Regions

`PropertyRegion` draws one property instance: the fields that plugin keeps to
itself, then whatever panels are scoped to the property.

The instance number appears **only when the object carries that property more
than once**. On a single Booth listing `#1` is noise; on two it is the only
thing telling them apart. Showing it on one and not the other would be worse
than showing neither, which is why the count comes from the whole object rather
than from the instance number.

## A plugin failing is not the page failing

Two ways a panel can be missing, and both end the same way — the region says
which plugin, and everything else draws:

- its module never loaded (`loader.ts` reported a failure)
- its module loaded and its default export is not a component

The second is what `panelComponent` checks. A plugin is external code; letting
React throw on a number would take the object page down over one bad plugin.
Contributions whose module failed are kept in the list carrying `undefined`
rather than filtered out, because a dropped contribution is a silent gap and a
named one is a bug report.

## The panel contract

`plugin-host/panel.ts`

```ts
interface PanelProps { api: Api; objectId: number; property: string; instance: number }
type Panel = ComponentType<PanelProps>
```

A panel is handed its `api` rather than importing one — the same injection the
loader and command API use, and with the same payoff: a panel is tested by
rendering it with a fake api. It also means a panel cannot widen its own reach,
since the api it receives is built from the allowlist.

`instance` matters: an object with two Booth listings gets two panels, and each
has to know which it is drawing or both render the same thing.

## The archive panel

`plugins/archive/panel.tsx` is the first plugin component, and it uses no
privilege a third party would not get.

The deciding stays in `panel.ts`: `summarise` is a pure function of a listing,
tested without a DOM. The component only turns its answer into elements. That
split is what lets the interesting question — which of 4000 entries to show —
be tested without rendering anything.

## Testing components

`vitest.config.ts` runs two projects: `.test.ts` in node, `.test.tsx` in jsdom.
Node is the default because it is faster and because an accidental DOM
dependency then fails instead of passing quietly.

Two things were needed to make component tests run at all, and both failed in a
way worth naming:

- **Primer imports its own CSS**, which node cannot load. Without
  `server.deps.inline`, the component tests did not fail — they refused to run
  while the suite still reported a passing count.
- **jsdom implements no `matchMedia`**, which Primer's theme asks for on first
  render, and Testing Library does not auto-clean without vitest globals. A
  suite missing the cleanup does not error; it finds the previous test's
  elements and asserts against them.

Both live in `src/ui/setup.ts`.
