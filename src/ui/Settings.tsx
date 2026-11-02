/**
 * What the library has decided about itself.
 *
 * Where it is, which plugins it runs, which theme the window uses, the order
 * its mounts take, and whatever else a plugin asked it to remember. Each is a
 * decision the person makes once for the whole library, which is why they
 * are here and not on any object's page.
 *
 * # Plugins take effect at the next open
 *
 * A registry is loaded once, and every panel on screen was arbitrated against
 * it. Rather than reload under a running page, the list is written and the
 * page says so: `enabled` and `running` are both shown, and they differ until
 * the window is opened again.
 */

import { Button, Checkbox, FormControl, Heading, IconButton, Select, Spinner, Stack, Text, TextInput } from "@primer/react";
import { ArrowDownIcon, ArrowUpIcon } from "@primer/octicons-react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type { Api, AppApi, LibraryInfo, MountRow, SettingRow } from "../plugin-host/commands.js";
import { CARD_SIZE } from "./Card.js";
import { PageHead } from "./PageHead.js";
import { describe } from "./problem.js";
import { parsePreference, type ThemePreference } from "./theme.js";

export interface SettingsProps {
  readonly api: Api;
  readonly app: AppApi;
  /** Changes when the library does, so mount order is re-read. */
  readonly generation: number;
  /** The theme changed; the window should follow at once. */
  readonly onTheme: (preference: ThemePreference) => void;
  /** Mount order changed; every page should re-read. */
  readonly onChanged: () => void;
}

export function Settings({ api, app, generation, onTheme, onChanged }: SettingsProps): React.JSX.Element {
  const [info, setInfo] = useState<LibraryInfo | undefined>(undefined);
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [mounts, setMounts] = useState<MountRow[]>([]);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [working, setWorking] = useState(false);

  // The plugin list as the person is editing it, before it is written.
  const [chosen, setChosen] = useState<Set<string> | undefined>(undefined);

  // A new setting being typed.
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  useEffect(() => {
    let current = true;
    Promise.all([app.libraryInfo(), app.settingAll(), api.mountOrder()])
      .then(([nextInfo, nextSettings, nextMounts]) => {
        if (!current) return;
        setInfo(nextInfo);
        setSettings(nextSettings);
        setMounts(nextMounts);
        setChosen(new Set(nextInfo.plugins.filter((p) => p.enabled).map((p) => p.id)));
      })
      .catch((error: unknown) => {
        if (current) setProblem(describe(error));
      });
    return () => {
      current = false;
    };
  }, [api, app, generation]);

  const run = (work: () => Promise<unknown>, then?: () => void): void => {
    setWorking(true);
    setProblem(undefined);
    work()
      .then(() => then?.())
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  const reloadSettings = (): void => {
    app.settingAll().then(setSettings).catch((error: unknown) => setProblem(describe(error)));
  };

  if (!info || !chosen) {
    return problem ? <InlineMessage variant="critical">{problem}</InlineMessage> : <Spinner aria-label="Reading the settings" />;
  }

  const theme = parsePreference(settings.find((s) => s.key === "theme")?.value);

  const move = (index: number, by: -1 | 1): void => {
    const next = [...mounts];
    const [row] = next.splice(index, 1);
    if (!row) return;
    next.splice(index + by, 0, row);
    run(
      () => app.mountOrderSet(next.map((m) => ({ namespace: m.namespace, instance: m.instance }))),
      () => {
        setMounts(next);
        onChanged();
      },
    );
  };

  return (
    <div>
      <PageHead title="Settings" detail={<span className="yk-mono">{info.root}</span>} />

      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}

      <div className="yk-sections">
      <Section title="Appearance">
        <FormControl>
          <FormControl.Label>Theme</FormControl.Label>
          <Select
            value={theme}
            disabled={working}
            onChange={(event) => {
              const next = parsePreference(event.target.value);
              run(
                () => app.settingSet("theme", next === "system" ? "" : next),
                () => {
                  onTheme(next);
                  reloadSettings();
                },
              );
            }}
          >
            <Select.Option value="system">Follow the system</Select.Option>
            <Select.Option value="light">Light</Select.Option>
            <Select.Option value="dark">Dark</Select.Option>
          </Select>
        </FormControl>
      </Section>

      <Section title="Plugins">
        <Text size="small">
          {info.chosen
            ? "This library runs the plugins ticked below."
            : "This library has not chosen, so everything installed runs."}{" "}
          A change takes effect the next time the library is opened.
        </Text>
        {info.plugins.map((plugin) => (
          <FormControl key={plugin.id} disabled={working}>
            <Checkbox
              checked={chosen.has(plugin.id)}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(plugin.id);
                else next.delete(plugin.id);
                setChosen(next);
              }}
            />
            <FormControl.Label>{plugin.id}</FormControl.Label>
            <FormControl.Caption>
              {plugin.directory}
              {plugin.running !== chosen.has(plugin.id) && " · changes at next open"}
              {!plugin.running && plugin.enabled && " · not running now"}
            </FormControl.Caption>
          </FormControl>
        ))}
        {info.skipped.map(([directory, reason]) => (
          <InlineMessage key={directory} variant="warning">
            {directory}: {reason}
          </InlineMessage>
        ))}
        <Stack direction="horizontal" gap="condensed">
          <Button
            size="small"
            variant="primary"
            disabled={working}
            onClick={() => run(() => app.pluginsEnable([...chosen]), () => app.libraryInfo().then(setInfo))}
          >
            Save plugin list
          </Button>
          <Button
            size="small"
            disabled={working}
            onClick={() =>
              run(
                () => app.pluginsEnable(null),
                () =>
                  app.libraryInfo().then((next) => {
                    setInfo(next);
                    setChosen(new Set(next.plugins.map((p) => p.id)));
                  }),
              )
            }
          >
            Run everything installed
          </Button>
        </Stack>
      </Section>

      <Section title="Mount order">
        <Text size="small">
          The one library-wide rule: which source a page shows first when two plugins name the same field.
        </Text>
        {mounts.length === 0 && <Text size="small">Nothing is mounted yet.</Text>}
        {mounts.length > 0 && (
          // Plain rows, not list items: a list item is itself a button, and
          // the arrows inside it would be buttons inside a button.
          <ol className="yk-order">
            {mounts.map((mount, index) => (
              <li key={`${mount.namespace}#${mount.instance}`} className="yk-order-row">
                <span className="yk-order-place">{index + 1}</span>
                <span className="yk-order-name">
                  {mount.namespace}
                  {mount.instance !== 1 && ` #${mount.instance}`}
                </span>
                {mount.namespace === FOUND ? (
                  // What the application found by itself always ranks last;
                  // the core sorts it there whatever order is written.
                  <span className="yk-muted yk-order-fixed">always last</span>
                ) : (
                  <>
                    <IconButton
                      icon={ArrowUpIcon}
                      size="small"
                      variant="invisible"
                      disabled={working || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${mount.namespace} up`}
                    />
                    <IconButton
                      icon={ArrowDownIcon}
                      size="small"
                      variant="invisible"
                      disabled={working || index === mounts.length - 1 || mounts[index + 1]?.namespace === FOUND}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${mount.namespace} down`}
                    />
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Other settings">
        <Text size="small">
          What plugins asked the library to remember. A plugin reads its own keys; `vrchat.grouping_depth` is how
          deep the VRChat scan&apos;s groupings go.
        </Text>
        {settings
          // The shell's own, each with a control of its own elsewhere.
          .filter((row) => row.key !== "theme" && row.key !== CARD_SIZE)
          .map((row) => (
            <Stack key={row.key} direction="horizontal" gap="condensed" align="center">
              <Text size="small" className="yk-mono">
                {row.key} = {row.value}
              </Text>
              <Button
                size="small"
                disabled={working}
                onClick={() => run(() => app.settingSet(row.key, ""), reloadSettings)}
                aria-label={`Clear ${row.key}`}
              >
                Clear
              </Button>
            </Stack>
          ))}
        <Stack direction="horizontal" gap="condensed" align="end" wrap="wrap">
          <FormControl>
            <FormControl.Label>Key</FormControl.Label>
            <TextInput value={key} onChange={(event) => setKey(event.target.value)} placeholder="vrchat.grouping_depth" />
          </FormControl>
          <FormControl>
            <FormControl.Label>Value</FormControl.Label>
            <TextInput value={value} onChange={(event) => setValue(event.target.value)} />
          </FormControl>
          <Button
            size="small"
            disabled={working || key.trim() === ""}
            onClick={() =>
              run(
                () => app.settingSet(key.trim(), value),
                () => {
                  setKey("");
                  setValue("");
                  reloadSettings();
                },
              )
            }
          >
            Set
          </Button>
        </Stack>
      </Section>
      </div>
    </div>
  );
}

/** The core's source for what it found by itself (`store::path::FOUND`). */
const FOUND = "found";

/** One boxed part of the page, titled. */
function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="yk-region">
      <header className="yk-region-head">
        <Heading as="h2" variant="small">
          {title}
        </Heading>
      </header>
      <div className="yk-region-body">{children}</div>
    </section>
  );
}
