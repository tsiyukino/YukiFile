/**
 * The parts of an object that are not fields: what it is, what it points at,
 * where it sits.
 *
 * Drawn under the regions on every object page when the page has an `app` to
 * write with. Each section is a list with a remove per row and one small form
 * to add a row, and each write goes through one `APP_ONLY` command and then
 * asks the page to re-read the object. Nothing here predicts what the core
 * will do; it asks.
 *
 * # Why this is in the framework and not a plugin
 *
 * A VRChat plugin will draw "fits Manuka, Lapwing" its own way, and should.
 * But an object carries edges whether or not the plugin that would draw them
 * is installed, and a person looking at a raw edge list can still fix a wrong
 * one. The framework's page shows the model; plugins show the meaning.
 */

import { ActionList, Button, FormControl, Heading, Select, Stack, Text, TextInput } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type {
  Api,
  AppApi,
  Edge,
  EdgeTarget,
  FlatObject,
  KnownPath,
  Summary,
  Term,
} from "../plugin-host/commands.js";
import type { Manifest } from "../plugin-host/types.js";
import {
  addableProperties,
  EDGE_KINDS,
  objectTargets,
  removableProperties,
  targetWording,
  vocabulariesOf,
} from "./edit.js";
import { describe } from "./problem.js";

export interface ObjectEditorProps {
  readonly api: Api;
  readonly app: AppApi;
  readonly object: FlatObject;
  readonly plugins: readonly Manifest[];
  /** The object changed; whoever owns it should re-read it. */
  readonly onChanged: () => void;
}

export function ObjectEditor({ api, app, object, plugins, onChanged }: ObjectEditorProps): React.JSX.Element {
  return (
    <Stack gap="normal">
      <Properties app={app} object={object} plugins={plugins} onChanged={onChanged} />
      <Links api={api} app={app} object={object} plugins={plugins} onChanged={onChanged} />
      <Locations app={app} object={object} onChanged={onChanged} />
    </Stack>
  );
}

/** Run one write, say what went wrong, and re-read on success. */
function useWrite(onChanged: () => void): {
  working: boolean;
  problem: string | undefined;
  run: (work: () => Promise<unknown>) => void;
} {
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const run = (work: () => Promise<unknown>): void => {
    setWorking(true);
    setProblem(undefined);
    work()
      .then(onChanged)
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };
  return { working, problem, run };
}

// --- what it is --------------------------------------------------------

function Properties({
  app,
  object,
  plugins,
  onChanged,
}: Omit<ObjectEditorProps, "api">): React.JSX.Element | null {
  const { working, problem, run } = useWrite(onChanged);
  const removable = removableProperties(object, plugins);
  const addable = addableProperties(object, plugins);
  const [picked, setPicked] = useState("");

  // No semantic property installed means nothing to say here. The regions
  // above already show the factual ones.
  if (removable.length === 0 && addable.length === 0) return null;

  const choice = picked || addable[0] || "";

  return (
    <Stack gap="condensed">
      <Heading as="h3">Is a</Heading>
      {removable.length > 0 && (
        <ActionList>
          {removable.map((property) => (
            <ActionList.Item key={property} onSelect={() => undefined}>
              {property}
              <ActionList.TrailingAction
                label={`Remove ${property}`}
                onClick={() => run(() => app.objectPropertyRemove(object.id, property))}
              >
                Remove
              </ActionList.TrailingAction>
            </ActionList.Item>
          ))}
        </ActionList>
      )}
      {addable.length > 0 && (
        <Stack direction="horizontal" gap="condensed" align="end">
          <FormControl>
            <FormControl.Label>Also a</FormControl.Label>
            <Select value={choice} onChange={(event) => setPicked(event.target.value)}>
              {addable.map((property) => (
                <Select.Option key={property} value={property}>
                  {property}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          <Button
            size="small"
            disabled={working || choice === ""}
            onClick={() => run(() => app.objectPropertyAdd(object.id, choice))}
          >
            Add property
          </Button>
        </Stack>
      )}
      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
    </Stack>
  );
}

// --- what it points at -------------------------------------------------

function Links({ api, app, object, plugins, onChanged }: ObjectEditorProps): React.JSX.Element {
  const { working, problem, run } = useWrite(onChanged);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [names, setNames] = useState<Summary[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [paths, setPaths] = useState<KnownPath[]>([]);
  const [reading, setReading] = useState<string | undefined>(undefined);

  // Declared by a manifest or held by the library: the seed's avatars arrive
  // by import before any plugin draws them, and a person can still say an
  // outfit fits one.
  const [held, setHeld] = useState<string[]>([]);
  const vocabularies = [...new Set([...vocabulariesOf(plugins), ...held])].sort();

  // New-edge form.
  const [kind, setKind] = useState("supports");
  const [aim, setAim] = useState<string>(vocabularies[0] ?? "object");
  const [term, setTerm] = useState("");
  const [path, setPath] = useState("");

  useEffect(() => {
    let current = true;
    const read = async (): Promise<void> => {
      const found = await api.objectEdges(object.id);
      const targets = objectTargets(found);
      const [named, known, inLibrary] = await Promise.all([
        targets.length > 0 ? api.objectSummaries(targets) : Promise.resolve([]),
        api.pathList(),
        api.termVocabularies(),
      ]);
      const every = [...new Set([...vocabulariesOf(plugins), ...inLibrary])].sort();
      const vocabTerms = await Promise.all(every.map((vocab) => api.termList(vocab)));
      if (!current) return;
      setEdges(found);
      setNames(named);
      setPaths(known);
      setHeld(inLibrary);
      setTerms(vocabTerms.flat());
      setAim((chosen) => (chosen === "object" || every.includes(chosen) ? chosen : every[0] ?? "object"));
    };
    read().catch((error: unknown) => {
      if (current) setReading(describe(error));
    });
    return () => {
      current = false;
    };
    // The object identity changes on every re-read, which is when edges may
    // have changed.
  }, [api, object, plugins]);

  const target = (): EdgeTarget | string => {
    if (aim === "object") {
      const found = paths.find((known) => known.path === path);
      return found ? { target: "object", id: found.object } : `nothing is recorded at "${path}"`;
    }
    if (term === "") return "pick a term";
    return { target: "term", vocab: aim, term };
  };

  const add = (): void => {
    const at = target();
    if (typeof at === "string") {
      run(() => Promise.reject(new Error(at)));
      return;
    }
    run(() => app.objectEdgeAdd(object.id, kind, at));
  };

  const termsIn = terms.filter((candidate) => candidate.vocab === aim);

  return (
    <Stack gap="condensed">
      <Heading as="h3">Points at</Heading>
      {reading && <InlineMessage variant="warning">{reading}</InlineMessage>}
      {edges.length === 0 && !reading && <Text size="small">Nothing yet.</Text>}
      {edges.length > 0 && (
        <ActionList>
          {edges.map((edge) => {
            const key =
              edge.target === "object" ? `${edge.kind}:o:${edge.id}` : `${edge.kind}:t:${edge.vocab}:${edge.term}`;
            return (
              <ActionList.Item key={key} onSelect={() => undefined}>
                {edge.kind}
                <ActionList.Description>{targetWording(edge, names, terms)}</ActionList.Description>
                <ActionList.TrailingAction
                  label={`Remove ${edge.kind} ${targetWording(edge, names, terms)}`}
                  onClick={() => run(() => app.objectEdgeRemove(object.id, edge.kind, edge))}
                >
                  Remove
                </ActionList.TrailingAction>
              </ActionList.Item>
            );
          })}
        </ActionList>
      )}

      <Stack direction="horizontal" gap="condensed" align="end" wrap="wrap">
        <FormControl>
          <FormControl.Label>Kind</FormControl.Label>
          <TextInput list="edge-kinds" value={kind} onChange={(event) => setKind(event.target.value)} />
          <datalist id="edge-kinds">
            {EDGE_KINDS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </FormControl>
        <FormControl>
          <FormControl.Label>To</FormControl.Label>
          <Select value={aim} onChange={(event) => setAim(event.target.value)}>
            {vocabularies.map((vocab) => (
              <Select.Option key={vocab} value={vocab}>
                a {vocab}
              </Select.Option>
            ))}
            <Select.Option value="object">an object, by path</Select.Option>
          </Select>
        </FormControl>
        {aim === "object" ? (
          <FormControl>
            <FormControl.Label>Path</FormControl.Label>
            <TextInput list="known-paths" value={path} onChange={(event) => setPath(event.target.value)} />
            <datalist id="known-paths">
              {paths.map((known) => (
                <option key={known.path} value={known.path} />
              ))}
            </datalist>
          </FormControl>
        ) : (
          <FormControl>
            <FormControl.Label>Term</FormControl.Label>
            <Select value={term} onChange={(event) => setTerm(event.target.value)}>
              <Select.Option value="">—</Select.Option>
              {termsIn.map((candidate) => (
                <Select.Option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
        )}
        <Button size="small" disabled={working} onClick={add}>
          Add link
        </Button>
      </Stack>
      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
    </Stack>
  );
}

// --- where it sits -----------------------------------------------------

function Locations({
  app,
  object,
  onChanged,
}: Pick<ObjectEditorProps, "app" | "object" | "onChanged">): React.JSX.Element {
  const { working, problem, run } = useWrite(onChanged);
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<"file" | "folder">("file");

  return (
    <Stack gap="condensed">
      <Heading as="h3">Sits at</Heading>
      {object.locations.length === 0 && (
        <Text size="small">Nowhere: this is a grouping.</Text>
      )}
      {object.locations.length > 0 && (
        <ActionList>
          {object.locations.map((location) => (
            <ActionList.Item key={location.path} onSelect={() => undefined}>
              {location.path}
              {location.kind === "folder" ? "/" : ""}
              <ActionList.TrailingAction
                label={`Remove ${location.path}`}
                onClick={() => run(() => app.objectPathRemove(object.id, location.path))}
              >
                Remove
              </ActionList.TrailingAction>
            </ActionList.Item>
          ))}
        </ActionList>
      )}
      <Stack direction="horizontal" gap="condensed" align="end" wrap="wrap">
        <FormControl>
          <FormControl.Label>Also at</FormControl.Label>
          <TextInput
            value={path}
            placeholder="Clothing/outfit.zip"
            onChange={(event) => setPath(event.target.value)}
          />
          <FormControl.Caption>Relative to the library root. It has to be there.</FormControl.Caption>
        </FormControl>
        <FormControl>
          <FormControl.Label>Which is a</FormControl.Label>
          <Select value={kind} onChange={(event) => setKind(event.target.value as "file" | "folder")}>
            <Select.Option value="file">file</Select.Option>
            <Select.Option value="folder">folder</Select.Option>
          </Select>
        </FormControl>
        <Button
          size="small"
          disabled={working || path.trim() === ""}
          onClick={() =>
            run(async () => {
              await app.objectPathAdd(object.id, { path: path.trim(), kind });
              setPath("");
            })
          }
        >
          Add location
        </Button>
      </Stack>
      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
    </Stack>
  );
}
