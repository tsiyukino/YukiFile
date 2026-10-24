//! What a library has decided about itself.
//!
//! One table of strings: which theme the window uses, how deep a plugin's
//! groupings go, whatever else a library needs to remember that is not about
//! any one object. Stored in the library's own database so that copying the
//! library copies its settings, and so a plugin's setting lives beside the
//! data it shapes rather than in the application's own folder.
//!
//! # Keys are namespaced by convention, not by the table
//!
//! `theme` is the application's; `vrchat.grouping_depth` is a plugin's. The
//! core reads none of them: a setting means whatever its reader says it
//! means, and the table only keeps the string. A plugin reads its own keys
//! through `setting.get` and a person writes them through the settings page;
//! a plugin that could write settings could change what another plugin's
//! scan does, which is the kind of reach the allowlist exists to refuse.

use rusqlite::{params, Connection, OptionalExtension};

/// One setting, if it has been set.
pub fn get(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
}

/// Set a setting. An empty value clears it: a blank is the absence of a
/// decision, same as a blank field.
pub fn set(connection: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    if value.is_empty() {
        connection.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    } else {
        connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
    }
    Ok(())
}

/// Every setting, by key.
pub fn all(connection: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut statement = connection.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect();
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema;

    #[test]
    fn a_setting_is_kept_replaced_and_cleared() {
        let connection = schema::open_in_memory().expect("open");

        assert_eq!(get(&connection, "theme").expect("get"), None);
        set(&connection, "theme", "dark").expect("set");
        assert_eq!(get(&connection, "theme").expect("get").as_deref(), Some("dark"));
        set(&connection, "theme", "light").expect("set");
        assert_eq!(get(&connection, "theme").expect("get").as_deref(), Some("light"));
        set(&connection, "theme", "").expect("clear");
        assert_eq!(get(&connection, "theme").expect("get"), None);
    }

    #[test]
    fn every_setting_comes_back_by_key() {
        let connection = schema::open_in_memory().expect("open");
        set(&connection, "vrchat.grouping_depth", "2").expect("set");
        set(&connection, "theme", "dark").expect("set");

        assert_eq!(
            all(&connection).expect("all"),
            vec![("theme".to_string(), "dark".to_string()), ("vrchat.grouping_depth".to_string(), "2".to_string())]
        );
    }
}
