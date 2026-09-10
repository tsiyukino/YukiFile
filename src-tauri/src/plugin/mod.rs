//! The plugin host: what a plugin declares, what it may ask for, and how the
//! core arbitrates between plugins.

pub mod commands;
pub mod discover;
pub mod enabled;
pub mod manifest;
pub mod registry;
