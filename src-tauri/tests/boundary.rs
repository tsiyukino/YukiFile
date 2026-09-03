//! The core must not know that any specific plugin exists.
//!
//! `docs.yml` states this as a convention and says it is enforced by a test
//! rather than by discipline. This is that test. It is written before the core
//! so that it constrains the core, rather than being written afterwards around
//! whatever the core already does.
//!
//! What it checks today is the import direction: no file under `src-tauri/src`
//! may name a plugin or reach into the plugin directory. The other two
//! boundary rules from the plan — that the plugin command surface is an
//! explicit allowlist, and that no built-in manifest declares a capability
//! third parties cannot — have nothing to check until layer 4 builds the
//! plugin host. They are recorded at the bottom of this file with the
//! conditions that activate them, rather than added now as tests that pass
//! because they inspect nothing.

use std::fs;
use std::path::{Path, PathBuf};

/// Names the core is never allowed to mention. Plugin ids follow the
/// `yukifile.<name>` form from the manifest example in the architecture doc;
/// the bare directory name is listed too, since `plugins/pdf` is as much a
/// reach across the boundary as `yukifile.pdf` is.
const FORBIDDEN: &[&str] = &[
    "yukifile.pdf",
    "yukifile.vrc",
    "yukifile.folder",
    "yukifile.file",
    "yukifile.archive",
    "plugins/pdf",
    "plugins/vrc",
    "plugins/folder",
    "plugins/file",
    "plugins/archive",
];

fn core_src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// Every `.rs` file under the core source tree.
fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));

    for entry in entries {
        let path = entry.expect("cannot read directory entry").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Strip `//` and `/* */` comments so that a doc comment discussing the
/// boundary does not trip the check. Without this, explaining the rule in a
/// comment would break the rule.
fn strip_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut chars = source.chars().peekable();
    let mut in_block = false;

    while let Some(c) = chars.next() {
        if in_block {
            if c == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block = false;
            }
            continue;
        }
        match (c, chars.peek()) {
            ('/', Some('/')) => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                in_block = true;
            }
            _ => out.push(c),
        }
    }
    out
}

#[test]
fn core_never_names_a_plugin() {
    let mut files = Vec::new();
    rust_files(&core_src(), &mut files);

    assert!(
        !files.is_empty(),
        "found no source files under {} — the check would pass vacuously",
        core_src().display()
    );

    let mut violations = Vec::new();

    for file in &files {
        let source = fs::read_to_string(file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        let code = strip_comments(&source);

        for needle in FORBIDDEN {
            if let Some(offset) = code.find(needle) {
                let line = code[..offset].lines().count();
                violations.push(format!(
                    "{}:{} names `{}`",
                    file.display(),
                    line,
                    needle
                ));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "the core reaches into plugins:\n  {}\n\n\
         The core is an arbiter. If it needs to know about a specific plugin, \
         the extension point is wrong and that is what should be fixed.",
        violations.join("\n  ")
    );
}

#[test]
fn comment_stripping_does_not_hide_real_code() {
    let source = r#"
// plugins/pdf in a line comment
/* plugins/vrc in a block comment */
let id = "plugins/folder";
"#;
    let code = strip_comments(source);

    assert!(!code.contains("plugins/pdf"), "line comment not stripped");
    assert!(!code.contains("plugins/vrc"), "block comment not stripped");
    assert!(
        code.contains("plugins/folder"),
        "stripping removed real code, which would make the boundary check blind"
    );
}

/// File extensions the built-in modules own. The core types an entry by
/// matching rules a plugin registered, and holds no extension of its own — a
/// third party adding `.blend` registers a rule rather than editing the core.
const PLUGIN_EXTENSIONS: &[&str] = &[
    "\"zip\"", "\"pdf\"", "\"docx\"", "\"png\"", "\"jpg\"", "\"jpeg\"",
    "\"unitypackage\"", "\"blend\"", "\"epub\"", "\"fbx\"",
];

#[test]
fn the_core_names_no_file_extension() {
    let mut files = Vec::new();
    rust_files(&core_src(), &mut files);

    let mut violations = Vec::new();

    for file in &files {
        let source = fs::read_to_string(file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        // Tests build rule sets out of extensions on purpose; the check is
        // about what the core ships, not what a test constructs.
        let code = strip_comments(&source);
        let Some(code) = code.split("#[cfg(test)]").next() else {
            continue;
        };

        for needle in PLUGIN_EXTENSIONS {
            if code.contains(needle) {
                violations.push(format!("{} contains {}", file.display(), needle));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "the core names a file extension:
  {}

         Typing an entry is done by rules a plugin registers. A core that          knows what .zip means is a core a third party has to edit to add          .blend.",
        violations.join("
  ")
    );
}

#[test]
fn a_built_in_manifest_goes_through_the_parser_third_parties_get() {
    // docs.yml: built-in plugins use the same contribution API as third-party
    // ones, and a built-in needing a special case in the core means the
    // extension point is wrong. The check is that every manifest under
    // plugins/ survives the ordinary parser -- no privileged fields, no
    // reserved namespaces, no contributions scoped to a property the plugin
    // has no relationship with.
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("plugins");
    if !plugins.exists() {
        return; // layer 5 adds the first built-in
    }

    for entry in fs::read_dir(&plugins).expect("read plugins/") {
        let manifest = entry.expect("read entry").path().join("manifest.json");
        if !manifest.exists() {
            continue;
        }
        let json = fs::read_to_string(&manifest)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", manifest.display()));

        yukifile::plugin::manifest::Manifest::parse(&json).unwrap_or_else(|error| {
            panic!(
                "{} is not a manifest a third party could have written: {error}",
                manifest.display()
            )
        });
    }
}

/// Every `#[tauri::command]` function name in one file.
fn annotated_commands(source: &str) -> Vec<String> {
    let code = strip_comments(source);
    let mut found = Vec::new();

    for (index, _) in code.match_indices("#[tauri::command]") {
        // The function name is whatever follows the next `fn`.
        let rest = &code[index..];
        let Some(fn_at) = rest.find("fn ") else { continue };
        let after = &rest[fn_at + 3..];
        let name: String = after
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() {
            found.push(name);
        }
    }
    found
}

#[test]
fn commands_are_annotated_only_in_the_bridge() {
    // The surface is one array, so widening what plugins can do is a diff to
    // one place. An annotation scattered through the source would work as
    // well at runtime and much worse in review -- nobody notices one more
    // #[tauri::command] in a file of forty.
    //
    // Confining them to one directory is what makes the correspondence check
    // below possible: a set that can be enumerated can be compared against
    // the list, and one scattered across the tree cannot.
    let mut files = Vec::new();
    rust_files(&core_src(), &mut files);

    let bridge = core_src().join("bridge");
    let mut stray = Vec::new();

    for file in &files {
        if file.starts_with(&bridge) {
            continue;
        }
        let source = fs::read_to_string(file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        let code = strip_comments(&source);

        if code.contains("#[tauri::command]") || code.contains("#[command]") {
            stray.push(file.display().to_string());
        }
    }

    assert!(
        stray.is_empty(),
        "these files outside src/bridge expose commands by annotation:\n  {}\n\n\
         Commands live in the bridge so the set of them can be compared \
         against plugin::commands::ALLOWED. An annotation elsewhere is a \
         second door that no list is watching.",
        stray.join("\n  ")
    );
}

#[test]
fn every_implemented_command_is_actually_registered() {
    // The third correspondence, and the one that fails most quietly. A
    // command can be on the list, implemented, annotated and documented, and
    // still be unreachable because nobody added it to the handler list -- at
    // which point every other check in this file passes and the command
    // simply does not answer.
    //
    // The macro's contents are hand-written, so nothing about it is derived
    // from the list the way handler_name is. That makes it exactly the kind
    // of second copy this file exists to catch.
    use std::collections::BTreeSet;

    let source = fs::read_to_string(core_src().join("bridge").join("mod.rs"))
        .expect("cannot read bridge/mod.rs");
    let code = strip_comments(&source);

    let macro_body = code
        .split_once("macro_rules! register_commands")
        .expect("register_commands! is gone")
        .1;
    let generate = macro_body
        .split_once("generate_handler![")
        .expect("the macro no longer registers a handler list")
        .1;
    let list = generate.split_once(']').expect("unterminated handler list").0;

    let registered: BTreeSet<String> = list
        .split(',')
        .filter_map(|entry| entry.trim().rsplit("::").next())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();

    let listed: BTreeSet<String> = yukifile::plugin::commands::ALLOWED
        .iter()
        .chain(yukifile::plugin::commands::APP_ONLY)
        .map(|command| yukifile::bridge::handler_name(command.name))
        .collect();

    let unreachable: Vec<&String> = listed.difference(&registered).collect();
    let phantom: Vec<&String> = registered.difference(&listed).collect();

    assert!(
        unreachable.is_empty(),
        "allowed and implemented but never registered, so calling one does \
         nothing: {unreachable:?}"
    );
    assert!(
        phantom.is_empty(),
        "registered but on neither list: {phantom:?}"
    );
}

#[test]
fn the_bridge_implements_exactly_what_the_list_allows() {
    // Both directions, because each failure is silent in its own way. A
    // listed command with no implementation is a documented capability that
    // errors at runtime; an implemented command that is not listed is a
    // capability nobody reviewed.
    use std::collections::BTreeSet;

    let mut files = Vec::new();
    rust_files(&core_src().join("bridge"), &mut files);

    let mut implemented: BTreeSet<String> = BTreeSet::new();
    for file in &files {
        let source = fs::read_to_string(file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        implemented.extend(annotated_commands(&source));
    }

    // Two lists: what plugins may call, and what only the application may.
    // Every annotation has to be on exactly one of them -- a command on
    // neither is one nobody reviewed, and keeping them apart is what makes
    // "who may call this" a question with a single answer.
    let listed: BTreeSet<String> = yukifile::plugin::commands::ALLOWED
        .iter()
        .chain(yukifile::plugin::commands::APP_ONLY)
        .map(|command| yukifile::bridge::handler_name(command.name))
        .collect();

    let missing: Vec<&String> = listed.difference(&implemented).collect();
    let unlisted: Vec<&String> = implemented.difference(&listed).collect();

    assert!(
        missing.is_empty(),
        "listed with no implementation in the bridge: {missing:?}"
    );
    assert!(
        unlisted.is_empty(),
        "implemented in the bridge but on neither list: {unlisted:?}\n\n\
         Every command has to be one visible row in plugin::commands::ALLOWED \
         or APP_ONLY, with a reason."
    );
}

#[test]
fn every_allowed_command_says_why_it_is_there() {
    // A command nobody can justify in a sentence is a command that should not
    // be on the list.
    for command in yukifile::plugin::commands::ALLOWED {
        assert!(
            !command.reason.trim().is_empty(),
            "{} is allowed with no reason given",
            command.name
        );
        assert!(
            !command.name.trim().is_empty(),
            "a command on the list has no name"
        );
    }
}
