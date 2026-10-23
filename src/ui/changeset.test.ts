import { describe, expect, test } from "vitest";

import type { ChangeEntry, ChangeSetSummary } from "../plugin-host/commands.js";
import { byObject, countsOf, decided, objectsOf, recount, wording } from "./changeset.js";

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

const set: ChangeSetSummary = {
  id: 7,
  label: "shop fetch",
  created: 0,
  additions: 3,
  modifications: 1,
  accepted: 3,
};

describe("grouping by object", () => {
  test("entries on one object sit together under its name", () => {
    const groups = byObject(
      [entry({ id: 1, object: "42", field: "title" }), entry({ id: 2, object: "42", field: "price" })],
      [{ id: "42", name: "Cross Maid", path: "a.zip", kind: "file" }],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Cross Maid");
    expect(groups[0]?.entries.map((e) => e.field)).toEqual(["title", "price"]);
  });

  test("objects keep the order they first appear in", () => {
    // The core sorts by object then field; sorting again here would be a
    // second answer.
    const groups = byObject(
      [entry({ id: 1, object: "9" }), entry({ id: 2, object: "3" }), entry({ id: 3, object: "9" })],
      [],
    );

    expect(groups.map((g) => g.object)).toEqual(["9", "3"]);
  });

  test("an object the summaries did not cover is shown unnamed, not dropped", () => {
    // A proposal about an object nobody can name is still a proposal.
    const groups = byObject([entry({ object: "77" })], []);

    expect(groups).toEqual([{ object: "77", name: null, entries: [entry({ object: "77" })] }]);
  });

  test("the objects to name are each asked for once", () => {
    expect(objectsOf([entry({ object: "1" }), entry({ object: "1" }), entry({ object: "2" })])).toEqual(
      ["1", "2"],
    );
  });
});

describe("saying what an entry would do", () => {
  test("a modification names both values", () => {
    expect(wording(entry())).toBe('would replace "mine" with "theirs"');
  });

  test("an addition names the new one", () => {
    expect(wording(entry({ old: null, new: "x", kind: "addition" }))).toBe('would set "x"');
  });

  test("clearing is said, not drawn as an arrow to nothing", () => {
    expect(wording(entry({ new: null }))).toBe('would clear "mine"');
  });

  test("a proposal that is empty on both sides says so", () => {
    expect(wording(entry({ old: null, new: null, kind: "addition" }))).toBe("would leave it empty");
  });
});

describe("the counts", () => {
  test("read as one line", () => {
    expect(countsOf(set)).toBe("3 additions and 1 modification, 3 accepted");
  });

  test("a kind with none is left out", () => {
    expect(countsOf({ ...set, additions: 0, accepted: 0 })).toBe("1 modification, 0 accepted");
  });

  test("an empty set says nothing rather than zero of each", () => {
    expect(countsOf({ ...set, additions: 0, modifications: 0, accepted: 0 })).toBe(
      "nothing, 0 accepted",
    );
  });
});

describe("after a decision", () => {
  test("one entry flips and the rest stay", () => {
    const after = decided([entry({ id: 1 }), entry({ id: 2 })], 2, true);

    expect(after.map((e) => e.accepted)).toEqual([false, true]);
  });

  test("the counts follow the entries", () => {
    const entries = [
      entry({ id: 1, kind: "addition", old: null, accepted: true }),
      entry({ id: 2, accepted: true }),
      entry({ id: 3 }),
    ];

    expect(recount(set, entries)).toMatchObject({ additions: 1, modifications: 2, accepted: 2 });
  });
});
