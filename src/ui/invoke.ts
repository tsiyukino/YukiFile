/**
 * The one place that talks to Tauri.
 *
 * `plugin-host/commands.ts` takes an {@link Invoke} rather than importing
 * Tauri, so that panels and the host can be tested without a running app.
 * That injection needs exactly one supplier, and this is it.
 *
 * Keeping it in a file of its own is what makes the rule checkable: an import
 * of `@tauri-apps/api` anywhere else is visible in a diff, and there is no
 * reason for a second one.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import type { Invoke } from "../plugin-host/commands.js";

/**
 * Call a command in the Rust bridge.
 *
 * Errors arrive as the serialised `BridgeError` — an object with `kind` — and
 * are rethrown untouched. Wrapping them in an `Error` here would flatten the
 * tag a caller switches on into a string it would have to match against.
 */
export const invoke: Invoke = (command, args) => tauriInvoke(command, args);
