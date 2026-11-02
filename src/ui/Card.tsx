/**
 * One object as a cover with a name under it.
 *
 * Shared by the grid and the term page, so an object looks the same wherever
 * it turns up. A card is two buttons side by side rather than one inside the
 * other: choosing the object and opening what it contains are different
 * things, and a button nested in a button is invalid markup that a browser
 * is free to rearrange.
 */

import {
  FileDirectoryIcon,
  FileIcon,
  FileMediaIcon,
  FileZipIcon,
  PackageIcon,
  StackIcon,
} from "@primer/octicons-react";
import { useEffect, useState } from "react";

import type { Api, ObjectId, Summary } from "../plugin-host/commands.js";
import "./grid.css";
import { pathUnder, placeholderFor, titleOf, type Placeholder } from "./grid.js";

/** How large the cards are drawn. */
export type CardSize = "small" | "medium" | "large";

/** The icon a placeholder draws. */
const ICONS: Record<Placeholder, React.ComponentType<{ size?: number }>> = {
  folder: FileDirectoryIcon,
  package: PackageIcon,
  archive: FileZipIcon,
  image: FileMediaIcon,
  document: FileIcon,
  file: FileIcon,
  grouping: StackIcon,
};

/** What a placeholder says in words, for the corner of an empty cover. */
const KINDS: Record<Placeholder, string> = {
  folder: "Folder",
  package: "Unity package",
  archive: "Archive",
  image: "Image",
  document: "Document",
  file: "File",
  grouping: "Group",
};

/**
 * A cover's URL, fetched once per path and shared across cards.
 *
 * `file.url` is a command per file; a page of sixty cards asks sixty times on
 * first draw and never again for the same path. Covers are stored under a
 * name made from their content, so a changed cover is a new path and never a
 * stale entry here.
 */
const urls = new Map<string, Promise<string>>();
export function urlFor(api: Api, path: string): Promise<string> {
  let held = urls.get(path);
  if (!held) {
    held = api.fileUrl(path);
    // A refusal is not remembered: the file may be back next time.
    held.catch(() => urls.delete(path));
    urls.set(path, held);
  }
  return held;
}

/** The URL for a stored cover path, or undefined while unknown or missing. */
export function useCoverUrl(api: Api, cover: string | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    if (!cover) return;
    urlFor(api, cover)
      .then((next) => {
        if (live) setUrl(next);
      })
      .catch(() => {
        if (live) setUrl(undefined);
      });
    return () => {
      live = false;
    };
  }, [api, cover]);
  return url;
}

export interface CardProps {
  readonly api: Api;
  readonly summary: Summary;
  readonly current?: boolean;
  /** The card was chosen. */
  readonly onChoose: () => void;
  /** What it contains was asked for. Absent when it contains nothing. */
  readonly onOpen?: (() => void) | undefined;
}

export function Card({ api, summary, current = false, onChoose, onOpen }: CardProps): React.JSX.Element {
  const url = useCoverUrl(api, summary.cover);
  const placeholder = placeholderFor(summary);
  const Icon = ICONS[placeholder];
  const under = pathUnder(summary);
  const name = titleOf(summary);
  const children = summary.children ?? 0;

  return (
    <li className="yk-card" data-current={current ? "true" : undefined}>
      <button type="button" className="yk-card-main" aria-current={current ? "true" : undefined} onClick={onChoose}>
        <div className="yk-cover" data-kind={url ? undefined : placeholder}>
          {url ? (
            <img src={url} alt="" loading="lazy" decoding="async" />
          ) : (
            <>
              <Icon size={32} />
              <span className="yk-cover-kind">{KINDS[placeholder]}</span>
            </>
          )}
        </div>
        <div className="yk-card-text">
          <div className="yk-card-name" title={name}>
            {name}
          </div>
          {under && (
            <div className="yk-card-path" title={under}>
              {under}
            </div>
          )}
        </div>
      </button>
      {onOpen && (
        <button
          type="button"
          className="yk-card-open"
          aria-label={`Open ${name}`}
          title={`${children} inside`}
          onClick={onOpen}
        >
          <StackIcon size={12} />
          {children}
        </button>
      )}
    </li>
  );
}

export interface CardGridProps {
  readonly api: Api;
  readonly rows: readonly Summary[];
  readonly size?: CardSize;
  readonly current?: ObjectId | undefined;
  readonly onChoose: (summary: Summary) => void;
  /** Offered on cards that contain something. */
  readonly onOpen?: ((summary: Summary) => void) | undefined;
  readonly label?: string;
}

/** A grid of cards. */
export function CardGrid({ api, rows, size = "medium", current, onChoose, onOpen, label }: CardGridProps): React.JSX.Element {
  return (
    <ul className="yk-grid" data-size={size} aria-label={label}>
      {rows.map((row) => (
        <Card
          key={row.id}
          api={api}
          summary={row}
          current={row.id === current}
          onChoose={() => onChoose(row)}
          onOpen={onOpen && (row.children ?? 0) > 0 ? () => onOpen(row) : undefined}
        />
      ))}
    </ul>
  );
}
