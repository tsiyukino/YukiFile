import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import type { Manifest } from "../plugin-host/types.js";
import { automaticActionsOf, runSwitchedOn, switchKey } from "./automatic.js";

const shop: Manifest = {
  id: "yukifile.vrchat",
  contributes: {
    library_actions: ["scan products", "fetch booth listings"],
    library_action_module: "./action",
    automatic_actions: ["fetch booth listings"],
    hosts: ["booth.pm"],
  },
};

describe("what may run by itself", () => {
  test("only what a plugin listed, and only if it is one of its library actions", () => {
    const sloppy: Manifest = { id: "x", contributes: { automatic_actions: ["not an action"] } };
    expect(automaticActionsOf([shop, sloppy])).toEqual([
      { plugin: "yukifile.vrchat", action: "fetch booth listings", hosts: ["booth.pm"] },
    ]);
  });

  test("its switch is a setting key with no spaces", () => {
    expect(switchKey({ plugin: "yukifile.vrchat", action: "fetch booth listings" })).toBe(
      "auto.yukifile.vrchat.fetch_booth_listings",
    );
  });
});

describe("running what is switched on", () => {
  function world(switched: string | null, run = vi.fn(async (props: { progress?: (d: number, t: number) => void }) => {
    props.progress?.(1, 2);
    return { summary: "3 of 3 listings fetched", changed: true };
  })) {
    const api = { settingGet: vi.fn(async () => switched) } as unknown as Api;
    const loaded: Loaded[] = [{ manifest: shop, modules: new Map([["./action", { runLibraryAction: run }]]), failures: [] }];
    return { api, loaded, run };
  }

  test("an action left off never runs, so nothing reaches the network unasked", async () => {
    const { api, loaded, run } = world(null);
    const outcome = await runSwitchedOn(api, {} as AppApi, [shop], loaded, () => undefined);
    expect(run).not.toHaveBeenCalled();
    expect(outcome.changed).toBe(false);
  });

  test("an action switched on runs, says how far it got, and what it did", async () => {
    const { api, loaded, run } = world("on");
    const onRunning = vi.fn();
    const outcome = await runSwitchedOn(api, {} as AppApi, [shop], loaded, onRunning);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: "fetch booth listings" }));
    expect(onRunning).toHaveBeenCalledWith({ action: "fetch booth listings", done: 1, total: 2 });
    expect(onRunning).toHaveBeenLastCalledWith(undefined);
    expect(outcome).toEqual({ changed: true, said: ["3 of 3 listings fetched"] });
  });

  test("a failure is said, not thrown", async () => {
    const { api, loaded } = world(
      "on",
      vi.fn(async () => {
        throw new Error("booth is down");
      }),
    );
    const outcome = await runSwitchedOn(api, {} as AppApi, [shop], loaded, () => undefined);
    expect(outcome.said).toEqual(["fetch booth listings failed: booth is down"]);
  });
});
