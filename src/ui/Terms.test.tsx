import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api } from "../plugin-host/commands.js";
import { TermList, TermPage } from "./Terms.js";

function api(over: Partial<Record<keyof Api, unknown>> = {}): Api {
  return {
    termVocabularies: async () => ["avatar", "author"],
    termList: async (vocab: string) =>
      vocab === "avatar"
        ? [
            { vocab, id: "manuka", label: "マヌカ" },
            { vocab, id: "lapwing", label: "lapwing" },
          ]
        : [{ vocab, id: "surin", label: "Surin" }],
    termObjects: async () => [
      { object: "1", kind: "supports" },
      { object: "1", kind: "owned" },
      { object: "2", kind: "supports" },
    ],
    objectSummaries: async (ids: string[]) =>
      ids.map((id) => ({ id, name: id === "1" ? "Cross Maid" : "Low Ponytail", path: `${id}.zip`, kind: "file" })),
    ...over,
  } as unknown as Api;
}

describe("the pane", () => {
  test("lists the first vocabulary's terms by label, with the id when it differs", async () => {
    render(<TermList api={api()} generation={0} selected={undefined} onSelect={() => undefined} />);

    expect(await screen.findByText("マヌカ")).toBeDefined();
    expect(screen.getByText("manuka")).toBeDefined();
    // Same label and id: said once, not twice.
    expect(screen.getAllByText("lapwing")).toHaveLength(1);
  });

  test("switching vocabulary lists its terms", async () => {
    render(<TermList api={api()} generation={0} selected={undefined} onSelect={() => undefined} />);

    await screen.findByText("マヌカ");
    fireEvent.change(screen.getByLabelText("Vocabulary"), { target: { value: "author" } });

    expect(await screen.findByText("Surin")).toBeDefined();
  });

  test("choosing a term hands up where it lives", async () => {
    const onSelect = vi.fn();
    render(<TermList api={api()} generation={0} selected={undefined} onSelect={onSelect} />);

    fireEvent.click(await screen.findByText("lapwing"));

    expect(onSelect).toHaveBeenCalledWith({ vocab: "avatar", id: "lapwing" });
  });

  test("a library with no vocabulary says so", async () => {
    render(
      <TermList
        api={api({ termVocabularies: async () => [] })}
        generation={0}
        selected={undefined}
        onSelect={() => undefined}
      />,
    );

    expect(await screen.findByText(/holds no vocabulary yet/)).toBeDefined();
  });
});

describe("the page", () => {
  test("what points at the term, grouped by kind, counted by object", async () => {
    render(
      <TermPage api={api()} term={{ vocab: "avatar", id: "manuka" }} generation={0} onSelect={() => undefined} />,
    );

    expect(await screen.findByText("マヌカ")).toBeDefined();
    expect(screen.getByText("2 objects point at this.")).toBeDefined();
    expect(screen.getByText("supports")).toBeDefined();
    expect(screen.getByText("owned")).toBeDefined();
    expect(screen.getAllByText("Cross Maid")).toHaveLength(2);
    expect(screen.getAllByText("Low Ponytail")).toHaveLength(1);
  });

  test("an object in the list opens", async () => {
    const onSelect = vi.fn();
    render(<TermPage api={api()} term={{ vocab: "avatar", id: "manuka" }} generation={0} onSelect={onSelect} />);

    fireEvent.click(await screen.findByText("Low Ponytail"));

    expect(onSelect).toHaveBeenCalledWith("2");
  });

  test("a term nothing points at says so rather than drawing nothing", async () => {
    render(
      <TermPage
        api={api({ termObjects: async () => [] })}
        term={{ vocab: "avatar", id: "lapwing" }}
        generation={0}
        onSelect={() => undefined}
      />,
    );

    expect(await screen.findByText("Nothing points at this yet.")).toBeDefined();
  });

  test("a term the vocabulary no longer holds is a different fact from an empty one", async () => {
    render(
      <TermPage
        api={api({ termObjects: async () => [] })}
        term={{ vocab: "avatar", id: "gone" }}
        generation={0}
        onSelect={() => undefined}
      />,
    );

    expect(await screen.findByText("No such term")).toBeDefined();
  });

  test("a refusal is shown", async () => {
    render(
      <TermPage
        api={api({ termObjects: async () => { throw { kind: "storage", detail: "x" }; } })}
        term={{ vocab: "avatar", id: "manuka" }}
        generation={0}
        onSelect={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByText("the core refused: storage")).toBeDefined());
  });
});
