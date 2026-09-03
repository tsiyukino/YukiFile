//! What a plugin may ask the core to do.
//!
//! Plugins are TypeScript; the heavy work is not. Scanning, hashing, archive
//! reading and database access are Rust in the core, exposed here as commands
//! a plugin calls. That keeps the barrier to writing a plugin low without
//! paying for it in performance, because a plugin is never the thing doing the
//! scanning.
//!
//! # The surface is a list, not a scattering of annotations
//!
//! Every command a plugin can reach is named in [`ALLOWED`]. Widening what
//! plugins can do is then a diff to one array — visible in review, and checked
//! by `src-tauri/tests/boundary.rs`.
//!
//! Marking functions individually would work as well at runtime and much worse
//! in review: nobody notices one more annotation in a file of forty, and the
//! question "what can a plugin do?" would have no single place to answer it.
//!
//! # What is deliberately absent
//!
//! No command writes a value, an edge or a term directly. A plugin proposes
//! through the import contract and a person reviews, because a plugin quietly
//! overwriting a decision is the failure change sets exist to prevent. Nothing
//! opens a file dialog, spawns a process, or reaches the network: `docs.yml`
//! says network access happens when the user presses a button, and a plugin is
//! not a button.

/// What a command does, so a caller can tell reads from writes without
/// knowing each command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    /// Reads library data or the filesystem. Safe to call freely.
    Read,
    /// Proposes changes for review. Nothing lands without a person.
    Propose,
    /// Writes directly. Only ever on [`APP_ONLY`]: a plugin that could write
    /// without review is the failure change sets exist to prevent.
    Write,
}

/// One thing a plugin may ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Command {
    pub name: &'static str,
    pub effect: Effect,
    /// Why a plugin needs it. A command nobody can justify in a sentence is a
    /// command that should not be here.
    pub reason: &'static str,
}

/// Everything a plugin may call. Adding a row widens what every installed
/// plugin can do.
pub const ALLOWED: &[Command] = &[
    Command {
        name: "object.get",
        effect: Effect::Read,
        reason: "a panel renders one object's values",
    },
    Command {
        name: "object.list",
        effect: Effect::Read,
        reason: "a column renders across the objects on screen",
    },
    Command {
        name: "object.flat",
        effect: Effect::Read,
        reason: "resolution runs in the backend because search, sort and export \
                 all need it, and two implementations of one rule drift apart",
    },
    Command {
        name: "object.ids",
        effect: Effect::Read,
        reason: "a grid draws a page of a 1518-object library, not all of it",
    },
    Command {
        name: "plugin.list",
        effect: Effect::Read,
        reason: "the host arbitrates slots from manifests it cannot otherwise see",
    },
    Command {
        name: "mount.order",
        effect: Effect::Read,
        reason: "slot ordering is mount order, which belongs to the library",
    },
    Command {
        name: "object.summaries",
        effect: Effect::Read,
        reason: "a list needs a name and a path per row, not one read per row",
    },
    Command {
        name: "object.edges",
        effect: Effect::Read,
        reason: "a panel shows what an object requires or supports",
    },
    Command {
        name: "term.resolve",
        effect: Effect::Read,
        reason: "a plugin reading filenames maps a spelling to a term",
    },
    Command {
        name: "term.list",
        effect: Effect::Read,
        reason: "a term page lists what a vocabulary holds",
    },
    Command {
        name: "archive.list",
        effect: Effect::Read,
        reason: "listing an archive without unpacking it is the whole reason \
                 a third of the seed library is visible",
    },
    Command {
        name: "fs.walk",
        effect: Effect::Read,
        reason: "what is on disk is a fact; what counts as an object is not",
    },
    Command {
        name: "file.url",
        effect: Effect::Read,
        reason: "a viewer renders a file it is never given the bytes of",
    },
    Command {
        name: "hash.of",
        effect: Effect::Read,
        reason: "a plugin identifying duplicates needs the same hash the core uses",
    },
    Command {
        name: "history.of",
        effect: Effect::Read,
        reason: "a panel shows what changed and when",
    },
    Command {
        name: "import.propose",
        effect: Effect::Propose,
        reason: "the only way a plugin changes anything: it proposes a \
                 document and a person reviews it",
    },
];

/// What only the application itself may ask for.
///
/// A second list, and the reason it is second rather than more rows in
/// [`ALLOWED`]: these are things a *person* does through the application's own
/// interface, not things a plugin may do on their behalf. `docs.yml` draws the
/// same line for the network — access happens when the user presses a button,
/// and a plugin is not a button.
///
/// Empty today. It held `library.scan` until scanning turned out to be the
/// wrong thing for the core to do at all: deciding what counts as an object is
/// domain knowledge, and `docs.yml` says the core has none. A plugin now walks
/// through `fs.walk` and submits through `import.propose`, so the capability
/// that needed this list stopped existing rather than moving.
///
/// The list stays because the distinction is real and the next thing to need
/// it — a file dialog, a network fetch — is a question of when rather than
/// whether.
pub const APP_ONLY: &[Command] = &[];

/// Whether a name is on either list.
pub fn is_known(name: &str) -> bool {
    is_allowed(name) || APP_ONLY.iter().any(|command| command.name == name)
}

/// Whether a name is on the list.
pub fn is_allowed(name: &str) -> bool {
    ALLOWED.iter().any(|command| command.name == name)
}

/// One command's entry, if it has one.
pub fn lookup(name: &str) -> Option<&'static Command> {
    ALLOWED.iter().find(|command| command.name == name)
}

/// Commands that change something, for a host that wants to confirm before
/// letting a plugin run one.
pub fn proposing() -> impl Iterator<Item = &'static Command> {
    ALLOWED.iter().filter(|command| command.effect == Effect::Propose)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_on_the_list_is_allowed() {
        assert!(is_allowed("archive.list"));
        assert!(is_allowed("import.propose"));
    }

    #[test]
    fn anything_not_on_the_list_is_refused() {
        // The point of a list rather than a scattering of annotations: what a
        // plugin cannot do is everything nobody wrote down.
        for name in ["fs.write", "process.spawn", "http.get", "values.overwrite", ""] {
            assert!(!is_allowed(name), "{name} was allowed");
        }
    }

    #[test]
    fn no_command_writes_directly() {
        // A plugin quietly overwriting a decision is the failure change sets
        // exist to prevent, so the only way a plugin changes anything is by
        // proposing.
        let writes: Vec<&str> = ALLOWED
            .iter()
            .filter(|c| c.effect == Effect::Propose)
            .map(|c| c.name)
            .collect();

        assert_eq!(writes, ["import.propose"], "something else can change data");
    }

    #[test]
    fn nothing_reaches_the_network_or_the_process_table() {
        // docs.yml: network access happens when the user presses a button,
        // and a plugin is not a button.
        for command in ALLOWED {
            for forbidden in ["http", "fetch", "net", "spawn", "exec", "shell"] {
                assert!(
                    !command.name.contains(forbidden),
                    "{} looks like it reaches outside",
                    command.name
                );
            }
        }
    }

    #[test]
    fn names_are_unique() {
        let mut seen = std::collections::BTreeSet::new();
        for command in ALLOWED {
            assert!(seen.insert(command.name), "{} is listed twice", command.name);
        }
    }

    #[test]
    fn a_command_can_be_looked_up_with_its_reason() {
        let command = lookup("archive.list").expect("listed");
        assert_eq!(command.effect, Effect::Read);
        assert!(command.reason.contains("unpacking"));
    }

    #[test]
    fn an_unlisted_lookup_finds_nothing() {
        assert!(lookup("fs.write").is_none());
    }

    #[test]
    fn proposing_commands_can_be_singled_out() {
        // A host that wants to confirm before letting a plugin change
        // anything needs to know which commands those are without knowing
        // each command.
        assert_eq!(proposing().count(), 1);
    }

    #[test]
    fn no_plugin_command_writes_without_review() {
        // The rule that caught a design error: library.scan was written onto
        // ALLOWED first, and this refused it. Scanning writes directly, so
        // either it goes through review -- which would make a first scan 1518
        // confirmations -- or it is not something a plugin may do. It is the
        // second.
        for command in ALLOWED {
            assert_ne!(
                command.effect,
                Effect::Write,
                "{} writes directly and is on the plugin list",
                command.name
            );
        }
    }

    #[test]
    fn the_two_lists_do_not_overlap() {
        // A command on both would make "who may call this" a question with two
        // answers, which is the confusion the split exists to remove.
        for app in APP_ONLY {
            assert!(
                !is_allowed(app.name),
                "{} is on both lists",
                app.name
            );
        }
    }

    #[test]
    fn everything_app_only_says_why_it_is_there() {
        for command in APP_ONLY {
            assert!(!command.reason.trim().is_empty(), "{} has no reason", command.name);
            assert!(!command.name.trim().is_empty(), "a command has no name");
        }
    }

    #[test]
    fn a_listed_command_is_known_and_nothing_else_is() {
        assert!(is_known("archive.list"));
        assert!(!is_known("fs.write"));
    }

    #[test]
    fn scanning_is_not_a_capability_any_more() {
        // It was on APP_ONLY until deciding what counts as an object turned
        // out to be domain knowledge the core has none of. A plugin walks
        // through fs.walk and submits through import.propose instead, so this
        // is not a command that moved -- it is one that stopped existing.
        assert!(!is_known("library.scan"));
        assert!(is_allowed("fs.walk"));
        assert!(is_allowed("import.propose"));
    }

    #[test]
    fn walking_reads_and_does_not_write() {
        // The split that makes the rest of it work: the core observes, the
        // plugin concludes, and a person reviews the conclusion.
        assert_eq!(lookup("fs.walk").expect("listed").effect, Effect::Read);
    }
}
