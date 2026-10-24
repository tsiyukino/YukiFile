/**
 * The picture that stands for an object.
 *
 * Shows the cover when there is one, resolved like every other shared field
 * -- a person's own choice first, a shop's after it. Offers to change it
 * from what the object's own locations hold: the images in its folder, the
 * images in its zip, the previews in its package. Nothing is fetched and
 * nothing passes through a plugin; the core reads the bytes and scales them.
 */

import { ActionList, Button, Spinner, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type { Api, AppApi, FlatObject } from "../plugin-host/commands.js";
import { fromFolder, fromPackage, fromZip, isPackage, isZip, packagesIn, type Choice } from "./covers.js";
import { describe } from "./problem.js";

export interface CoverProps {
  readonly api: Api;
  readonly app?: AppApi | undefined;
  readonly object: FlatObject;
  readonly onChanged?: (() => void) | undefined;
}

export function Cover({ api, app, object, onChanged }: CoverProps): React.JSX.Element | null {
  const sources = object.shared["cover"] ?? [];
  const held = sources[0]?.value;
  const own = sources.find((source) => source.from === null)?.value;

  const [url, setUrl] = useState<string | undefined>(undefined);
  const [choosing, setChoosing] = useState(false);
  const [choices, setChoices] = useState<Choice[] | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setUrl(undefined);
    if (!held) return;
    api
      .fileUrl(held)
      .then((next) => {
        if (current) setUrl(next);
      })
      .catch(() => {
        // A cover whose file is gone draws nothing; the page says the field
        // still holds a path, which is the honest state.
        if (current) setUrl(undefined);
      });
    return () => {
      current = false;
    };
  }, [api, held]);

  // Gathered when asked for, not on every page draw: listing a zip or a
  // package reads it, and most visits to a page are not to change its cover.
  const gather = async (): Promise<Choice[]> => {
    const found: Choice[] = [];
    for (const location of object.locations) {
      if (location.kind === "folder") {
        found.push(...fromFolder(location, await api.fsWalk(location.path, 1)));
      } else if (isZip(location.path)) {
        const members = await api.archiveList(location.path);
        found.push(...fromZip(location, members));
        for (const member of packagesIn(members)) {
          found.push(...fromPackage(location, await api.unitypackageList(location.path, member), member));
        }
      } else if (isPackage(location.path)) {
        found.push(...fromPackage(location, await api.unitypackageList(location.path)));
      }
    }
    return found;
  };

  const open = (): void => {
    setChoosing(true);
    setChoices(undefined);
    setProblem(undefined);
    gather()
      .then(setChoices)
      .catch((error: unknown) => {
        setProblem(describe(error));
        setChoices([]);
      });
  };

  const pick = (choice: Choice): void => {
    if (!app) return;
    setWorking(true);
    setProblem(undefined);
    app
      .coverSet(object.id, choice.source)
      .then(() => {
        setChoosing(false);
        onChanged?.();
      })
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  const clear = (): void => {
    if (!app) return;
    setWorking(true);
    app
      .objectValueSet(object.id, "cover", "")
      .then(() => onChanged?.())
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  if (!held && !app) return null;

  return (
    <Stack gap="condensed">
      {url && (
        <img
          src={url}
          alt="Cover"
          style={{ maxWidth: 256, maxHeight: 256, objectFit: "contain", borderRadius: 6 }}
        />
      )}
      {held && !url && <Text size="small">cover: {held}</Text>}

      {app && (
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" disabled={working} onClick={open}>
            {held ? "Change cover" : "Choose cover"}
          </Button>
          {own !== undefined && (
            <Button size="small" variant="danger" disabled={working} onClick={clear}>
              Clear cover
            </Button>
          )}
        </Stack>
      )}

      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}

      {choosing && choices === undefined && <Spinner size="small" aria-label="Looking for pictures" />}
      {choosing && choices && choices.length === 0 && !problem && (
        <Text size="small">Nothing here holds a picture the core can read.</Text>
      )}
      {choosing && choices && choices.length > 0 && (
        <ActionList>
          {choices.map((choice) => (
            <ActionList.Item key={choice.label} disabled={working} onSelect={() => pick(choice)}>
              {choice.label}
            </ActionList.Item>
          ))}
        </ActionList>
      )}
      {choosing && (
        <Button size="small" onClick={() => setChoosing(false)}>
          Cancel
        </Button>
      )}
    </Stack>
  );
}
