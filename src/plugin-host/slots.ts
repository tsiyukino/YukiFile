/**
 * Who renders where, and in what order.
 *
 * A plugin never says where on screen it wants to be. It says which property
 * it is scoped to, and the core places that property's region. This module is
 * the second half of that sentence: given the plugins, an object's properties
 * and the library's mount order, it answers what belongs in each slot.
 *
 * # Three inputs, no state
 *
 * Everything here is a pure function of its arguments. Nothing reads a
 * registry, a store or a window. That matters because the same question gets
 * asked from several places — the object page, the context menu, the command
 * palette, the grid header — and a stateful arbiter would answer them
 * differently depending on what was loaded when.
 *
 * # Ordering falls out of mount order
 *
 * Two plugins scoped to `booth` and `gumroad` are ordered by which of those
 * the library mounts first, not by which manifest loaded first. That reuses a
 * decision the user already made once, in a place they can see it, instead of
 * inventing a second priority list per slot.
 *
 * Within one property, the plugin that *defines* it comes before plugins that
 * merely require it: a price-comparison panel sits after Booth's own, because
 * the thing being compared is the thing that comes first.
 */

import { bareName, type Manifest, type PropertyInstance } from "./types.js";

/**
 * One mounted property instance, in the order the library mounts it.
 *
 * Mirrors `store::flatten::Mount`. The instance counter is carried because
 * an object with `booth#1` and `booth#2` gets two of everything, and a panel
 * has to know which page it is rendering.
 */
export interface Mount {
  readonly namespace: string;
  readonly instance: number;
}

/** One plugin's offer for one slot on one property instance. */
export interface Contribution {
  /** The plugin id that offered it. */
  readonly plugin: string;
  /** The property it is scoped to: `booth`. */
  readonly property: string;
  /** Which instance of that property, so a panel knows which page it draws. */
  readonly instance: number;
  /**
   * What was offered: a module specifier for panels and viewers, an action
   * id for actions, a column id for columns.
   */
  readonly value: string;
}

/**
 * Mount order, ranked.
 *
 * Anything not mounted has no rank, and a contribution to it does not appear —
 * an object can carry values for a plugin this library does not mount, and
 * they wait in storage until it does.
 */
function ranks(order: readonly Mount[]): Map<string, number> {
  const rank = new Map<string, number>();
  order.forEach((mount, position) => {
    rank.set(`${mount.namespace}#${mount.instance}`, position);
  });
  return rank;
}

/** Whether a plugin declares this property rather than requiring it. */
function defines(manifest: Manifest, property: string): boolean {
  return manifest.contributes?.properties?.includes(property) ?? false;
}

/** Whether a plugin is scoped to a property at all. */
function scopedTo(manifest: Manifest, property: string): boolean {
  return (
    defines(manifest, property) ||
    (manifest.requires?.properties?.includes(property) ?? false)
  );
}

/** An instance of a property as carried by an object. */
interface Carried {
  readonly namespace: string;
  readonly instance: number;
}

/**
 * Split what an object carries into namespace and instance.
 *
 * A bare `booth` is instance 1, matching how the store writes the first
 * instance of a property. Anything whose counter is not a positive integer is
 * dropped rather than guessed at: a malformed path is corruption, and picking
 * an instance for it would attach a panel to a page that does not exist.
 *
 * The counter has to be the *canonical* spelling of its number, not merely
 * digits. `booth#01` is all digits and reads as 1, so a laxer check would let
 * it through to match the mount key for `booth#1` and draw a second panel over
 * the first — one Booth listing rendered twice. Round-tripping the number back
 * to a string is what rules that out, and it rules out the same trick in every
 * other spelling (`1.0`, `1e0`, `+1`) at the same time.
 */
function carriedInstances(carried: readonly PropertyInstance[]): Carried[] {
  const parsed: Carried[] = [];
  for (const entry of carried) {
    const namespace = bareName(entry);
    if (namespace === "") continue;

    const hash = entry.indexOf("#");
    if (hash === -1) {
      parsed.push({ namespace, instance: 1 });
      continue;
    }

    const counter = entry.slice(hash + 1);
    const instance = Number(counter);
    if (!Number.isInteger(instance) || instance < 1) continue;
    if (String(instance) !== counter) continue;
    parsed.push({ namespace, instance });
  }
  return parsed;
}

/**
 * Collect one slot's contributions for one object.
 *
 * `carried` is what the object actually has, instances and all. A contribution
 * whose property the object does not carry never appears — that is the whole
 * visibility rule, and it is the same rule for every slot.
 */
function collect(
  plugins: readonly Manifest[],
  carried: readonly PropertyInstance[],
  order: readonly Mount[],
  read: (manifest: Manifest) => Readonly<Record<string, unknown>> | undefined,
  values: (offered: unknown) => readonly string[],
): Contribution[] {
  const rank = ranks(order);
  const found: Array<{ contribution: Contribution; at: number; own: number }> = [];

  for (const { namespace, instance } of carriedInstances(carried)) {
    const at = rank.get(`${namespace}#${instance}`);
    if (at === undefined) continue;

    for (const plugin of plugins) {
      if (!scopedTo(plugin, namespace)) continue;
      const offered = read(plugin)?.[namespace];
      if (offered === undefined) continue;

      for (const value of values(offered)) {
        found.push({
          contribution: { plugin: plugin.id, property: namespace, instance, value },
          at,
          own: defines(plugin, namespace) ? 0 : 1,
        });
      }
    }
  }

  found.sort((left, right) => left.at - right.at || left.own - right.own);
  return found.map(({ contribution }) => contribution);
}

/** A slot offering exactly one thing per property: a module specifier. */
const one = (offered: unknown): readonly string[] =>
  typeof offered === "string" ? [offered] : [];

/** A slot offering a list per property: actions, columns. */
const many = (offered: unknown): readonly string[] =>
  Array.isArray(offered) ? offered.filter((entry) => typeof entry === "string") : [];

/** Panels for an object, in the order they should be drawn. */
export function panelsFor(
  plugins: readonly Manifest[],
  carried: readonly PropertyInstance[],
  order: readonly Mount[],
): Contribution[] {
  return collect(plugins, carried, order, (m) => m.contributes?.panels, one);
}

/**
 * Viewers for an object.
 *
 * More than one is normal — a PDF that is also a product has two ways of being
 * looked at — and choosing between them belongs to the user, not to this
 * module. The order is a default, not a decision.
 */
export function viewersFor(
  plugins: readonly Manifest[],
  carried: readonly PropertyInstance[],
  order: readonly Mount[],
): Contribution[] {
  return collect(plugins, carried, order, (m) => m.contributes?.viewers, one);
}

/**
 * Actions for an object.
 *
 * Independent of layout by design: these reach the user through the context
 * menu and the command palette, so a plugin that owns an object's whole page
 * cannot strand another plugin's actions.
 */
export function actionsFor(
  plugins: readonly Manifest[],
  carried: readonly PropertyInstance[],
  order: readonly Mount[],
): Contribution[] {
  return collect(plugins, carried, order, (m) => m.contributes?.actions, many);
}

/**
 * Columns offered across a set of objects.
 *
 * A grid header is drawn once for many objects, so `carried` here is the union
 * of what those objects carry. Duplicates are collapsed, because two objects
 * both carrying `booth#1` offer Booth's price column once and not twice.
 */
export function columnsFor(
  plugins: readonly Manifest[],
  carried: readonly PropertyInstance[],
  order: readonly Mount[],
): Contribution[] {
  const seen = new Set<string>();
  return collect(plugins, carried, order, (m) => m.contributes?.columns, many).filter(
    (contribution) => {
      const key = [
        contribution.plugin,
        contribution.property,
        contribution.instance,
        contribution.value,
      ].join(" ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );
}
