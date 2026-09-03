//! Where the allowlist becomes callable code.
//!
//! `plugin::commands::ALLOWED` names what a plugin may ask for. This module is
//! the other half: each row there has exactly one function here, registered
//! with Tauri.
//!
//! # Why the annotations live here and nowhere else
//!
//! `tests/boundary.rs` refuses `#[tauri::command]` anywhere in the core. The
//! rule exists because an annotation scattered through forty files makes "what
//! can a plugin do?" a question with no single answer.
//!
//! Wiring commands has to write that annotation somewhere, so the rule became
//! narrower and stricter at the same time: annotations are confined to this
//! directory, and the set of them must *equal* the allowlist. A command
//! implemented but not listed fails the boundary test. A command listed but
//! not implemented fails it too. Neither half can drift from the other without
//! a test going red, which is more than the original rule caught — it only
//! watched for a second door, and could not tell whether the first one was
//! ever built.
//!
//! # The bridge knows the core; the core does not know the bridge
//!
//! Everything here converts: core errors into [`error::BridgeError`], store
//! rows into [`views`] types. None of the core's types carry serde derives for
//! the bridge's benefit, because the shape a plugin is told is not the shape
//! the schema holds, and the two have separate reasons to change.

pub mod commands;
pub mod error;
pub mod library;
pub mod views;

pub use error::BridgeError;
pub use library::Library;

/// The Tauri command name for a row of the allowlist.
///
/// `object.get` is invoked as `object_get`. The mapping is mechanical so that
/// a command cannot be listed under one name and implemented under another —
/// a lookup table would be a third place to keep in step.
pub fn handler_name(listed: &str) -> String {
    listed.replace('.', "_")
}

/// Register every command with a Tauri builder.
///
/// One call site, so the registered set and the allowlist are compared in one
/// place rather than trusted to stay aligned across a dozen `invoke_handler`
/// calls.
#[macro_export]
macro_rules! register_commands {
    ($builder:expr) => {
        $builder.invoke_handler(tauri::generate_handler![
            $crate::bridge::commands::object_get,
            $crate::bridge::commands::object_list,
            $crate::bridge::commands::object_flat,
            $crate::bridge::commands::object_ids,
            $crate::bridge::commands::plugin_list,
            $crate::bridge::commands::mount_order,
            $crate::bridge::commands::object_edges,
            $crate::bridge::commands::term_resolve,
            $crate::bridge::commands::term_list,
            $crate::bridge::commands::archive_list,
            $crate::bridge::commands::hash_of,
            $crate::bridge::commands::history_of,
            $crate::bridge::commands::import_propose,
            $crate::bridge::commands::library_scan,
        ])
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_listed_name_becomes_its_handler_name() {
        assert_eq!(handler_name("object.get"), "object_get");
        assert_eq!(handler_name("import.propose"), "import_propose");
    }

    #[test]
    fn a_name_with_no_dot_is_unchanged() {
        assert_eq!(handler_name("hash"), "hash");
    }
}
