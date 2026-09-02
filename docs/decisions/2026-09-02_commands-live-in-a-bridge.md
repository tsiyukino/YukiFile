# Commands live in a bridge, and the boundary rule got stricter

**2026-09-02**

## What was decided

`#[tauri::command]` annotations are confined to `src-tauri/src/bridge/`, and
the set of them must equal `plugin::commands::ALLOWED`. The boundary test that
previously refused the annotation everywhere now refuses it everywhere *except*
the bridge, and adds a two-way correspondence check.

## Why the old rule could not stand

At layer 0, before any command existed, `boundary.rs` asserted that no file
under `src-tauri/src` contains `#[tauri::command]`. The reasoning was sound —
an annotation scattered through forty files makes "what can a plugin do?" a
question with no single answer — but the rule was written against a codebase
where the answer was trivially "nothing".

Wiring the first command has to write that annotation somewhere. Three ways
out were on the table:

1. Confine annotations to one directory and compare the set against the list.
2. Put them all in `main.rs`, which is still under `src/` and fails the same
   check.
3. Keep the rule and register commands by hand, avoiding the macro.

The third is choosing a worse implementation to avoid failing one's own test,
which is the shape of compromise this project's rules exist to refuse. The
second does not actually satisfy the rule. So: the first.

## Why this is stricter, not looser

The old rule watched for a second door being added. It could not tell whether
the first door had been built, because it inspected only for absence.

The new one checks both directions:

- A command on the allowlist with no implementation fails. That is a
  documented capability which errors at runtime — the kind of gap a plugin
  author finds and the core author does not.
- A command implemented but not listed fails. That is a capability nobody
  reviewed, which is exactly what the allowlist exists to prevent.

Confinement is what makes the second check possible. A set that can be
enumerated can be compared against a list; one scattered across a source tree
cannot.

## What the list still cannot say

`ALLOWED` says `archive.list` and `hash.of` only read. It has no way to say
*what* they may read, and plugins are TypeScript passing arbitrary strings.

So path confinement lives in `bridge::library`, not in the list: every path a
plugin names is resolved against the library root and refused if it lands
outside. Without it, "read-only" would have meant read-only access to the
entire disk through a command whose stated reason is listing a zip.

This is the general shape of the split. The allowlist is a review artifact —
it makes widening the surface one visible diff. It is not an enforcement
mechanism for what any individual command does with its arguments, and treating
it as one would leave every argument unchecked.

## Consequences

- `tauri` is now a dependency of the core crate, not only of a future binary.
- `tests/confinement.rs` exists as a separate file from `boundary.rs`: the
  boundary tests read source and ask whether the code is shaped right, these
  run the code and ask whether it refuses.
- The core still names no plugin. That rule is untouched.
