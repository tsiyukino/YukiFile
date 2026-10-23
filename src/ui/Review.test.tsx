import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi, ChangeEntry, ChangeSetSummary } from "../plugin-host/commands.js";
import { ReviewList, ReviewPage } from "./Review.js";

function entry(over: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: 1,
    object: "42",
    field: "title",
    old: "mine",
    new: "theirs",
    reason: null,
    accepted: false,
    kind: "modification",
    ...over,
  };
}

const summary: ChangeSetSummary = {
  id: 7,
  label: "shop fetch",
  created: 0,
  additions: 0,
  modifications: 1,
  accepted: 0,
};

/** A library holding one set, whose entries the fake app can change. */
function world(initial: ChangeEntry[] = [entry()]) {
  let entries = initial;
  const api = {
    changesPending: vi.fn(async () => [
      { ...summary, accepted: entries.filter((e) => e.accepted).length },
    ]),
    changesEntries: vi.fn(async () => entries),
    objectSummaries: vi.fn(async () => [{ id: "42", name: "Cross Maid", path: "a.zip", kind: "file" }]),
  };
  const app = {
    changesAccept: vi.fn(async (change: number, accepted: boolean) => {
      entries = entries.map((e) => (e.id === change ? { ...e, accepted } : e));
    }),
    changesAcceptAdditions: vi.fn(async () => {
      entries = entries.map((e) => (e.kind === "addition" ? { ...e, accepted: true } : e));
      return 0;
    }),
    changesAcceptAll: vi.fn(async (_set: number, accepted: boolean) => {
      entries = entries.map((e) => ({ ...e, accepted }));
      return entries.length;
    }),
    changesApply: vi.fn(async () => ({ changed: 1, already_matched: 0, declined: 0 })),
  };
  return { api: api as unknown as Api, app: app as unknown as AppApi, calls: { api, app } };
}

describe("listing what is waiting", () => {
  test("each set is a row with its label and counts", async () => {
    const { api } = world();
    render(<ReviewList api={api} generation={0} selected={undefined} onSelect={() => undefined} />);

    expect(await screen.findByText("shop fetch")).toBeDefined();
    expect(screen.getByText("1 modification, 0 accepted")).toBeDefined();
  });

  test("nothing waiting says so", async () => {
    const api = { changesPending: async () => [] } as unknown as Api;
    render(<ReviewList api={api} generation={0} selected={undefined} onSelect={() => undefined} />);

    expect(await screen.findByText("Nothing is waiting for review.")).toBeDefined();
  });

  test("choosing a set hands its id up", async () => {
    const { api } = world();
    const onSelect = vi.fn();
    render(<ReviewList api={api} generation={0} selected={undefined} onSelect={onSelect} />);

    fireEvent.click(await screen.findByText("shop fetch"));

    expect(onSelect).toHaveBeenCalledWith(7);
  });
});

describe("reviewing one set", () => {
  test("entries are grouped under the object they touch, in words", async () => {
    const { api, app } = world();
    render(<ReviewPage api={api} app={app} set={7} onApplied={() => undefined} />);

    expect(await screen.findByText("Cross Maid")).toBeDefined();
    expect(screen.getByText('would replace "mine" with "theirs"')).toBeDefined();
  });

  test("a modification starts unticked", async () => {
    const { api, app } = world();
    render(<ReviewPage api={api} app={app} set={7} onApplied={() => undefined} />);

    await screen.findByText("Cross Maid");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  test("ticking an entry writes the decision at once", async () => {
    // A review half done survives closing the window.
    const { api, app, calls } = world();
    render(<ReviewPage api={api} app={app} set={7} onApplied={() => undefined} />);

    await screen.findByText("Cross Maid");
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(calls.app.changesAccept).toHaveBeenCalledWith(1, true));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    // The apply button counts what is accepted now.
    expect(screen.getByRole("button", { name: "Apply 1 of 1" })).toBeDefined();
  });

  test("a bulk action re-reads the set rather than guessing its effect", async () => {
    const { api, app, calls } = world([
      entry({ id: 1, kind: "addition", old: null, accepted: false }),
      entry({ id: 2 }),
    ]);
    render(<ReviewPage api={api} app={app} set={7} onApplied={() => undefined} />);

    await screen.findByText("Cross Maid");
    fireEvent.click(screen.getByRole("button", { name: "Accept additions" }));

    await waitFor(() => expect(calls.app.changesAcceptAdditions).toHaveBeenCalledWith(7));
    await waitFor(() => expect(calls.api.changesEntries).toHaveBeenCalledTimes(2));
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
  });

  test("applying writes and hands control back", async () => {
    const { api, app, calls } = world();
    const onApplied = vi.fn();
    render(<ReviewPage api={api} app={app} set={7} onApplied={onApplied} />);

    await screen.findByText("Cross Maid");
    fireEvent.click(screen.getByRole("button", { name: "Apply 0 of 1" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(calls.app.changesApply).toHaveBeenCalledWith(7);
  });

  test("a field that moved is said beside the entry it is about", async () => {
    // The refusal names the field. Showing it as a line at the bottom would
    // send the person hunting for which entry it meant.
    const { api, app } = world();
    (app.changesApply as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw {
        kind: "stale",
        detail: { object: "42", field: "title", expected: "mine", found: "changed meanwhile" },
      };
    });
    const onApplied = vi.fn();
    render(<ReviewPage api={api} app={app} set={7} onApplied={onApplied} />);

    await screen.findByText("Cross Maid");
    fireEvent.click(screen.getByRole("button", { name: "Apply 0 of 1" }));

    expect(
      await screen.findByText(
        'title changed since this was proposed: it was "mine" and is now "changed meanwhile"',
      ),
    ).toBeDefined();
    expect(onApplied).not.toHaveBeenCalled();
  });

  test("a set that is gone says so rather than drawing an empty review", async () => {
    const api = {
      changesPending: async () => [],
      changesEntries: async () => {
        throw { kind: "no_such_set", detail: 7 };
      },
    } as unknown as Api;
    render(<ReviewPage api={api} app={{} as AppApi} set={7} onApplied={() => undefined} />);

    expect(await screen.findByText("the core refused: no_such_set")).toBeDefined();
  });
});
