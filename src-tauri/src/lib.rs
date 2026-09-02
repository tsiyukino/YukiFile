//! Yukifile core.
//!
//! The core stores objects, hangs typed values on them under namespaced paths,
//! records edges between them, and arbitrates between plugins. It knows nothing
//! about what any of those objects mean; that lives in plugins.
//!
//! Modules are added here as the layers in
//! `docs/decisions/2026-09-01_v1-scope-and-build-order.md` are built.

pub mod bridge;
pub mod changes;
pub mod commands;
pub mod contract;
pub mod plugin;
pub mod scan;
pub mod store;
