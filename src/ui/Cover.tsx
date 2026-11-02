/**
 * The picture that stands for an object.
 *
 * Shows the cover when there is one, resolved like every other shared field
 * -- a person's own choice first, a shop's after it. Offers to change it
 * from what the object's own locations hold: the images in its folder, the
 * images in its zip, the previews in its package. Nothing is fetched and
 * nothing passes through a plugin; the core reads the bytes and scales them.
 */

import { ActionList, Button, Dialog, Spinner, Stack, Text } from "@primer/react";
import { FileDirectoryIcon, FileIcon, FileMediaIcon, FileZipIcon, ImageIcon, PackageIcon, StackIcon } from "@primer/octicons-react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type { Api, AppApi, FlatObject } from "../plugin-host/commands.js";
import { fromFolder, fromPackage, fromZip, isPackage, isZip, packagesIn, type Choice } from "./covers.js";
import { placeholderFor, type Placeholder } from "./grid.js";
import { describe } from "./problem.js";

/** The icon an empty frame draws, matching the grid's cards. */
const ICONS: Record<Placeholder, React.ComponentType<{ size?: number }>> = {
  folder: FileDirectoryIcon,
  package: PackageIcon,
  archive: FileZipIcon,
  image: FileMediaIcon,
  document: FileIcon,
  file: FileIcon,
  grouping: StackIcon,
};

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
  // A cover the application found by itself can be cleared like a person's
  // own: it was a guess, and a wrong guess has to be removable.
  const found = sources[0]?.from === "found#1" ? sources[0].value : undefined;

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
      .objectValueSet(object.id, own !== undefined ? "cover" : "found#1/cover", "")
      .then(() => onChanged?.())
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  const first = object.locations[0];
  const placeholder = placeholderFor({ path: first?.path ?? null, kind: first?.kind ?? null });
  const Icon = ICONS[placeholder];

  return (
    <Stack gap="condensed">
      {/* The same frame with or without a picture, so the page does not
          jump when one arrives, and a grid card and its page look alike. */}
      <div className="yk-cover yk-object-cover" data-kind={url ? undefined : placeholder}>
        {url ? <img src={url} alt="Cover" /> : <Icon size={48} />}
      </div>
      {held && !url && <Text size="small" className="yk-muted">cover: {held}</Text>}

      {app && (
        <Stack direction="horizontal" gap="condensed" wrap="wrap">
          <Button size="small" leadingVisual={ImageIcon} disabled={working} onClick={open}>
            {held ? "Change cover" : "Choose cover"}
          </Button>
          {(own !== undefined || found !== undefined) && (
            <Button size="small" variant="danger" disabled={working} onClick={clear}>
              Clear cover
            </Button>
          )}
        </Stack>
      )}

      {problem && !choosing && <InlineMessage variant="critical">{problem}</InlineMessage>}

      {choosing && (
        <Dialog title="Choose a cover" width="large" onClose={() => setChoosing(false)}>
          <Stack gap="condensed">
            <Text size="small" className="yk-muted">
              Pictures inside this object&apos;s own locations: its folder, its archives, the previews in its packages.
            </Text>
            {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
            {choices === undefined && <Spinner size="small" aria-label="Looking for pictures" />}
            {choices && choices.length === 0 && !problem && (
              <Text size="small">Nothing here holds a picture the core can read.</Text>
            )}
            {choices && choices.length > 0 && (
              <ActionList>
                {choices.map((choice) => (
                  <ActionList.Item key={choice.label} disabled={working} onSelect={() => pick(choice)}>
                    <ActionList.LeadingVisual>
                      <ImageIcon />
                    </ActionList.LeadingVisual>
                    {choice.label}
                  </ActionList.Item>
                ))}
              </ActionList>
            )}
          </Stack>
        </Dialog>
      )}
    </Stack>
  );
}
