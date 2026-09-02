//! Vocabularies: controlled lists of names that objects point at.
//!
//! A **term** is a name with aliases and no path. Objects are files; terms are
//! the words you describe them with, and the two are separate because the real
//! library proves they have to be: 73 avatars are referenced by assets and 21
//! bases are owned, so modelling the rest as objects would put 52 pathless
//! shells in every listing and every backup.
//!
//! An **alias** is one surface form of a term. Booth lists compatibility in
//! Japanese while filenames are in English, so `桔梗`, `Kikyo` and `Kikyou`
//! are one term with three spellings, and an outfit whose folder says one and
//! whose shop page says another has to resolve to the same thing.
//!
//! Resolution here is exact, after case folding. Matching a short name loosely
//! against arbitrary text is a different problem with different rules — `sio`
//! occurs inside `Expressions`, and requiring extra evidence for short names is
//! a heuristic that belongs to whichever plugin is reading filenames. This
//! module answers "is this exact string a known spelling", and nothing more.

use rusqlite::{Connection, OptionalExtension, params};

/// A name in a vocabulary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Term {
    pub vocab: String,
    pub id: String,
    /// The form shown to a person. `id` is the stable key; this is what a
    /// listing prints, and it may be in any script.
    pub label: String,
}

/// Add a term, or update its label if it already exists.
///
/// Idempotent because seeding a vocabulary runs whenever a plugin loads, and
/// that must not fail on the second run or lose an edited label silently.
pub fn put_term(
    connection: &Connection,
    vocab: &str,
    id: &str,
    label: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO terms (vocab, id, label) VALUES (?1, ?2, ?3)
         ON CONFLICT (vocab, id) DO UPDATE SET label = excluded.label",
        params![vocab, id, label],
    )?;
    Ok(())
}

/// One term, if it exists.
pub fn term(connection: &Connection, vocab: &str, id: &str) -> rusqlite::Result<Option<Term>> {
    connection
        .query_row(
            "SELECT vocab, id, label FROM terms WHERE vocab = ?1 AND id = ?2",
            params![vocab, id],
            read_term,
        )
        .optional()
}

/// Every term in a vocabulary, by id.
pub fn terms(connection: &Connection, vocab: &str) -> rusqlite::Result<Vec<Term>> {
    let mut statement = connection
        .prepare("SELECT vocab, id, label FROM terms WHERE vocab = ?1 ORDER BY id")?;
    let terms = statement.query_map(params![vocab], read_term)?.collect();
    terms
}

/// Remove a term. Its aliases and the edges pointing at it go with it, by
/// cascade.
pub fn remove_term(connection: &Connection, vocab: &str, id: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM terms WHERE vocab = ?1 AND id = ?2",
        params![vocab, id],
    )?;
    Ok(())
}

/// Record that `surface` is a spelling of `term`.
///
/// Surfaces are stored folded, so `LUMINA` and `Lumina` — both of which occur
/// in the seed data — are one alias rather than two. Folding is Unicode
/// lowercase, which leaves Japanese untouched, since it has no case.
pub fn put_alias(
    connection: &Connection,
    vocab: &str,
    surface: &str,
    term: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO aliases (vocab, surface, term) VALUES (?1, ?2, ?3)
         ON CONFLICT (vocab, surface) DO UPDATE SET term = excluded.term",
        params![vocab, fold(surface), term],
    )?;
    Ok(())
}

/// The term a spelling refers to, if any.
///
/// A term's own id counts as a spelling of itself, so seeding an alias for it
/// is not required.
pub fn resolve(
    connection: &Connection,
    vocab: &str,
    surface: &str,
) -> rusqlite::Result<Option<String>> {
    let folded = fold(surface);

    let by_alias: Option<String> = connection
        .query_row(
            "SELECT term FROM aliases WHERE vocab = ?1 AND surface = ?2",
            params![vocab, folded],
            |row| row.get(0),
        )
        .optional()?;

    if by_alias.is_some() {
        return Ok(by_alias);
    }

    // Folding happens here rather than in SQL. SQLite's lower() only folds
    // ASCII, so a term id carrying a diacritic — which an author vocabulary
    // certainly will — would be compared against a Rust-folded surface and
    // never match. One folding rule, applied on one side.
    let mut statement = connection.prepare("SELECT id FROM terms WHERE vocab = ?1")?;
    let mut rows = statement.query(params![vocab])?;

    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        if fold(&id) == folded {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

/// Every spelling of one term, folded, in order.
pub fn aliases(connection: &Connection, vocab: &str, term: &str) -> rusqlite::Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT surface FROM aliases WHERE vocab = ?1 AND term = ?2 ORDER BY surface",
    )?;
    let surfaces = statement.query_map(params![vocab, term], |row| row.get(0))?.collect();
    surfaces
}

/// Remove one spelling, leaving the term and its other spellings.
pub fn remove_alias(connection: &Connection, vocab: &str, surface: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM aliases WHERE vocab = ?1 AND surface = ?2",
        params![vocab, fold(surface)],
    )?;
    Ok(())
}

/// The vocabularies that have any terms.
pub fn vocabularies(connection: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut statement =
        connection.prepare("SELECT DISTINCT vocab FROM terms ORDER BY vocab")?;
    let vocabs = statement.query_map([], |row| row.get(0))?.collect();
    vocabs
}

/// Fold a surface form for comparison.
///
/// Unicode lowercase, which SQLite's own `lower()` is not — that one leaves
/// anything outside ASCII alone, so `ÄÖÜ` comes back unchanged. Every
/// comparison in this module goes through here, so the two rules never get a
/// chance to disagree.
///
/// Nothing else is done. Trimming or stripping punctuation would make `Kikyo!`
/// resolve to `kikyo`, which is a guess this module has no basis for; a plugin
/// wanting loose matching does it on its own terms.
fn fold(surface: &str) -> String {
    surface.to_lowercase()
}

fn read_term(row: &rusqlite::Row<'_>) -> rusqlite::Result<Term> {
    Ok(Term { vocab: row.get(0)?, id: row.get(1)?, label: row.get(2)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema;

    fn db() -> Connection {
        schema::open_in_memory().expect("open")
    }

    /// The avatar vocabulary as `seed/alias.json` has it.
    fn avatars() -> Connection {
        let connection = db();
        let seed: &[(&str, &str, &[&str])] = &[
            ("kikyo", "桔梗", &["Kikyo", "Kikyou", "桔梗"]),
            ("shinano", "信濃", &["Shinano", "しなの", "信濃"]),
            ("manuka", "マヌカ", &["Manuka", "マヌカ"]),
            ("lumina", "LUMINA", &["LUMINA", "Lumina"]),
            ("selestia", "セレスティア", &["Selestia", "セレスティア"]),
        ];
        for (id, label, forms) in seed {
            put_term(&connection, "avatar", id, label).expect("term");
            for surface in *forms {
                put_alias(&connection, "avatar", surface, id).expect("alias");
            }
        }
        connection
    }

    // --- terms ------------------------------------------------------------

    #[test]
    fn a_term_has_a_label_in_its_own_script() {
        let connection = avatars();
        let term = term(&connection, "avatar", "kikyo").expect("read").expect("present");

        assert_eq!(term.id, "kikyo");
        assert_eq!(term.label, "桔梗");
    }

    #[test]
    fn seeding_a_vocabulary_twice_is_quiet() {
        // Seeding runs whenever a plugin loads.
        let connection = db();
        put_term(&connection, "avatar", "manuka", "Manuka").expect("first");
        put_term(&connection, "avatar", "manuka", "マヌカ").expect("second");

        let term = term(&connection, "avatar", "manuka").expect("read").expect("present");
        assert_eq!(term.label, "マヌカ", "the second seeding should update the label");
        assert_eq!(terms(&connection, "avatar").expect("list").len(), 1);
    }

    #[test]
    fn a_missing_term_is_absent_not_an_error() {
        // Selestia is referenced by 22 assets and its base was never bought.
        // "Not owned" is information, not a failure.
        let connection = db();
        assert_eq!(term(&connection, "avatar", "selestia").expect("read"), None);
    }

    #[test]
    fn vocabularies_stay_apart() {
        // Academic authors and shop vendors are separate lists with different
        // aliasing rules. The same id in both is two different terms.
        let connection = db();
        put_term(&connection, "author", "tanaka", "Tanaka").expect("author");
        put_term(&connection, "vendor", "tanaka", "TANAKA Shop").expect("vendor");

        assert_eq!(
            term(&connection, "author", "tanaka").expect("read").expect("present").label,
            "Tanaka"
        );
        assert_eq!(
            term(&connection, "vendor", "tanaka").expect("read").expect("present").label,
            "TANAKA Shop"
        );
        assert_eq!(vocabularies(&connection).expect("list"), ["author", "vendor"]);
    }

    // --- aliases ----------------------------------------------------------

    #[test]
    fn three_spellings_collapse_to_one_term() {
        // The case the vocabulary decision is written around: a folder says
        // Kikyo and the shop page says 桔梗.
        let connection = avatars();
        for surface in ["Kikyo", "Kikyou", "桔梗"] {
            assert_eq!(
                resolve(&connection, "avatar", surface).expect("resolve"),
                Some("kikyo".to_string()),
                "{surface} did not resolve"
            );
        }
    }

    #[test]
    fn japanese_and_english_spellings_meet() {
        let connection = avatars();
        assert_eq!(
            resolve(&connection, "avatar", "しなの").expect("kana"),
            resolve(&connection, "avatar", "Shinano").expect("latin")
        );
    }

    #[test]
    fn resolution_ignores_case() {
        // LUMINA and Lumina both occur in the seed data.
        let connection = avatars();
        for surface in ["LUMINA", "Lumina", "lumina", "LuMiNa"] {
            assert_eq!(
                resolve(&connection, "avatar", surface).expect("resolve"),
                Some("lumina".to_string()),
                "{surface} did not resolve"
            );
        }
    }

    #[test]
    fn a_term_resolves_by_its_own_id() {
        // No alias is needed for the id itself.
        let connection = db();
        put_term(&connection, "avatar", "manuka", "Manuka").expect("term");

        assert_eq!(
            resolve(&connection, "avatar", "Manuka").expect("resolve"),
            Some("manuka".to_string())
        );
    }

    #[test]
    fn resolution_folds_beyond_ascii() {
        // SQLite's own lower() leaves anything outside ASCII alone, so folding
        // in SQL misses here. The id has to carry the uppercase form for this
        // to bite: with a lowercase id, SQL's lower() is the identity and the
        // comparison accidentally works.
        let connection = db();
        put_term(&connection, "author", "GÖDEL", "Kurt Gödel").expect("term");

        assert_eq!(
            resolve(&connection, "author", "gödel").expect("resolve"),
            Some("GÖDEL".to_string()),
            "a term id with a non-ASCII capital did not fold"
        );
    }

    #[test]
    fn an_unknown_spelling_resolves_to_nothing() {
        let connection = avatars();
        assert_eq!(resolve(&connection, "avatar", "nobody").expect("resolve"), None);
    }

    #[test]
    fn resolution_is_exact_not_substring() {
        // sio occurs inside Expressions. Loose matching is a plugin's
        // heuristic and needs extra evidence; this module does not guess.
        let connection = db();
        put_term(&connection, "avatar", "sio", "しお").expect("term");

        assert_eq!(resolve(&connection, "avatar", "Expressions").expect("q"), None);
        assert_eq!(resolve(&connection, "avatar", "sio_outfit").expect("q"), None);
        assert_eq!(
            resolve(&connection, "avatar", "sio").expect("q"),
            Some("sio".to_string())
        );
    }

    #[test]
    fn punctuation_is_not_stripped() {
        let connection = avatars();
        assert_eq!(resolve(&connection, "avatar", "Kikyo!").expect("q"), None);
    }

    #[test]
    fn every_spelling_of_a_term_can_be_listed() {
        let connection = avatars();
        let mut forms = aliases(&connection, "avatar", "kikyo").expect("list");
        forms.sort();
        assert_eq!(forms, ["kikyo", "kikyou", "桔梗"]);
    }

    #[test]
    fn an_alias_can_be_moved_to_another_term() {
        // A misfiled spelling gets corrected rather than duplicated.
        let connection = avatars();
        put_alias(&connection, "avatar", "Kikyou", "manuka").expect("move");

        assert_eq!(
            resolve(&connection, "avatar", "Kikyou").expect("resolve"),
            Some("manuka".to_string())
        );
        assert_eq!(aliases(&connection, "avatar", "kikyo").expect("list").len(), 2);
    }

    #[test]
    fn removing_one_spelling_leaves_the_others() {
        let connection = avatars();
        remove_alias(&connection, "avatar", "Kikyou").expect("remove");

        assert_eq!(resolve(&connection, "avatar", "Kikyou").expect("q"), None);
        assert_eq!(
            resolve(&connection, "avatar", "桔梗").expect("q"),
            Some("kikyo".to_string())
        );
    }

    #[test]
    fn an_alias_must_name_a_term_that_exists() {
        let connection = db();
        assert!(put_alias(&connection, "avatar", "X", "nobody").is_err());
    }

    // --- removal ----------------------------------------------------------

    #[test]
    fn removing_a_term_takes_its_spellings() {
        let connection = avatars();
        remove_term(&connection, "avatar", "kikyo").expect("remove");

        assert_eq!(resolve(&connection, "avatar", "桔梗").expect("q"), None);
        assert!(aliases(&connection, "avatar", "kikyo").expect("list").is_empty());
    }

    #[test]
    fn removing_a_term_takes_the_edges_pointing_at_it() {
        use crate::store::edges::{self, Target};
        use crate::store::values::Values;

        let connection = avatars();
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("object");
        edges::add(
            &connection,
            object,
            "supports",
            &Target::Term { vocab: "avatar".into(), id: "kikyo".into() },
        )
        .expect("edge");

        remove_term(&connection, "avatar", "kikyo").expect("remove");
        assert!(edges::from(&connection, object, None).expect("read").is_empty());
    }

    // --- the whole point --------------------------------------------------

    #[test]
    fn buying_a_base_later_needs_no_migration() {
        // 22 assets point at Selestia and no base is owned. Buying it adds one
        // object and one edge; the existing 22 connect with nothing rewritten.
        use crate::store::edges::{self, Target};
        use crate::store::values::Values;

        let connection = db();
        let mut values = Values::new();
        put_term(&connection, "avatar", "selestia", "セレスティア").expect("term");

        let selestia = Target::Term { vocab: "avatar".into(), id: "selestia".into() };
        for _ in 0..22 {
            let asset = values.create_object(&connection).expect("asset");
            edges::add(&connection, asset, "supports", &selestia).expect("edge");
        }
        assert_eq!(edges::count_to_term(&connection, "avatar", "selestia").expect("c"), 22);

        // Later: the base is bought.
        let base = values.create_object(&connection).expect("base");
        edges::add(&connection, base, "is_avatar", &selestia).expect("claim");

        let all = edges::to_term(&connection, "avatar", "selestia", None).expect("read");
        assert_eq!(all.len(), 23);
        assert_eq!(
            edges::to_term(&connection, "avatar", "selestia", Some("is_avatar"))
                .expect("owned")
                .len(),
            1
        );
    }
}
