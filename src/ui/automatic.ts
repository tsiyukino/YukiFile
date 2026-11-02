/**
 * Plugin actions that run without a press, once a person says so.
 *
 * `2026-10-24_the-network-is-lent-to-a-press.md` lent the network to a
 * press. `2026-11-02_a-switch-can-stand-for-a-press.md` lets a switch stand
 * for one: a plugin lists which of its library actions may run by
 * themselves (`automatic_actions`), and a library runs one only after a
 * person switches it on. The switch is a library setting, so it is this
 * library's decision and copies with it; the network is still lent only for
 * the hosts the plugin named.
 */

import { pressedApiFor, type Api, type AppApi } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import { libraryAction } from "../plugin-host/panel.js";
import type { Manifest } from "../plugin-host/types.js";

/** One action that may run by itself. */
export interface Automatic {
  readonly plugin: string;
  readonly action: string;
  /** Where it may reach, as the manifest named them. */
  readonly hosts: readonly string[];
}

/** Every action any plugin allows to run by itself. */
export function automaticActionsOf(plugins: readonly Manifest[]): Automatic[] {
  return plugins.flatMap((plugin) =>
    (plugin.contributes?.automatic_actions ?? [])
      .filter((action) => plugin.contributes?.library_actions?.includes(action))
      .map((action) => ({ plugin: plugin.id, action, hosts: plugin.contributes?.hosts ?? [] })),
  );
}

/**
 * The setting that switches one on: `auto.yukifile.vrchat.fetch_booth_listings`.
 * A setting key may not hold spaces, and an action's name may.
 */
export function switchKey(automatic: Pick<Automatic, "plugin" | "action">): string {
  return `auto.${automatic.plugin}.${automatic.action.trim().replace(/\s+/g, "_")}`;
}

/** What a run reports while it goes and when it is done. */
export interface Running {
  readonly action: string;
  readonly done: number;
  readonly total: number;
}

/**
 * Run every switched-on action, one after another.
 *
 * Returns the summaries of those that changed something. One that fails is
 * reported and the rest still run: a shop being down is no reason not to
 * do the next plugin's work.
 */
export async function runSwitchedOn(
  api: Api,
  app: AppApi,
  plugins: readonly Manifest[],
  loaded: readonly Loaded[],
  onRunning: (running: Running | undefined) => void,
): Promise<{ changed: boolean; said: string[] }> {
  const said: string[] = [];
  let changed = false;
  for (const automatic of automaticActionsOf(plugins)) {
    const on = await api.settingGet(switchKey(automatic)).catch(() => null);
    if (on !== "on") continue;

    const specifier = plugins.find((p) => p.id === automatic.plugin)?.contributes?.library_action_module;
    const owner = loaded.find((entry) => entry.manifest.id === automatic.plugin);
    const run = specifier ? libraryAction(owner?.modules.get(specifier)) : undefined;
    if (!run) continue;

    onRunning({ action: automatic.action, done: 0, total: 0 });
    try {
      const outcome = await run({
        api: pressedApiFor(api, app, automatic.hosts),
        action: automatic.action,
        progress: (done, total) => onRunning({ action: automatic.action, done, total }),
      });
      if (outcome.changed) {
        changed = true;
        said.push(outcome.summary);
      }
    } catch (error: unknown) {
      said.push(`${automatic.action} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  onRunning(undefined);
  return { changed, said };
}
