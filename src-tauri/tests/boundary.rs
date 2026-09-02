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

#[test]
fn every_command_a_plugin_can_reach_is_on_the_list() {
    // The surface is one array, so widening what plugins can do is a diff to
    // one place. An annotation scattered through the source would work as
    // well at runtime and much worse in review -- nobody notices one more
    // #[tauri::command] in a file of forty.
    //
    // This checks the inverse: no function is exposed except through that
    // array. If Tauri command attributes appear in core source, they have to
    // be registered somewhere the list can see.
    //
    // Nothing is wired to Tauri yet, so today this guards against a second
    // door being added rather than watching one that exists. That is the
    // useful order: the check is in place before the first command is, so
    // adding one the wrong way fails on the way in.
    let mut files = Vec::new();
    rust_files(&core_src(), &mut files);

    let mut annotated = Vec::new();

    for file in &files {
        let source = fs::read_to_string(file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        let code = strip_comments(&source);

        if code.contains("#[tauri::command]") || code.contains("#[command]") {
            annotated.push(file.display().to_string());
        }
    }

    assert!(
        annotated.is_empty(),
        "these files expose commands by annotation rather than through          plugin::commands::ALLOWED:
  {}

         The allowlist exists so that widening what a plugin can do is one          visible diff. An annotation somewhere else is a second door.",
        annotated.join("
  ")
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
