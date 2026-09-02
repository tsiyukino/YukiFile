//! Edges: anything that points at something else.
//!
//! ```text
//! outfit    --requires-->   mochifitter core
//! gagset21  --patches-->    gagset
//! avatar    --contains-->   outfit, hair, texture
//! noir141   --supersedes--> noir12
//! outfit    --supports-->   avatar:manuka
//! ```
//!
//! One table, one `kind` column. Plugin dependencies, product bundles, version
//! successors and compatibility all reduce to this, which is what makes
//! "what fits Manuka?" one indexed query rather than a scan over array fields.
//!
//! `kind` is free text here as it is in the schema. The core does not
//! enumerate valid kinds, so a plugin adding `cites` or `remixes` needs no
//! change on either side.
//!
//! The database stores a target as three nullable columns with a CHECK that
//! exactly one shape is filled. This module does not repeat that shape: a
//! [`Target`] is an enum, so "both" and "neither" cannot be written down. The
//! CHECK stays as the guarantee against anything reaching the table another
//! way.

use rusqlite::{Connection, params};

/// What an edge points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// Another object in this library.
    Object(i64),
    /// A vocabulary term: `avatar:manuka`. Terms have no path, which is the
    /// point — the seed library references 73 avatars and owns 21 bases.
    Term { vocab: String, id: String },
}

/// An edge, as read back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edge {
    pub src: i64,
    pub kind: String,
    pub target: Target,
}

/// Record an edge. Recording the same edge twice is not an error and does not
/// duplicate it — a rescan should be able to reassert what it found.
pub fn add(
    connection: &Connection,
    src: i64,
    kind: &str,
    target: &Target,
) -> rusqlite::Result<()> {
    if exists(connection, src, kind, target)? {
        return Ok(());
    }
    match target {
        Target::Object(dst) => connection.execute(
            "INSERT INTO edges (src, kind, dst_object) VALUES (?1, ?2, ?3)",
            params![src, kind, dst],
        ),
        Target::Term { vocab, id } => connection.execute(
            "INSERT INTO edges (src, kind, dst_vocab, dst_term) VALUES (?1, ?2, ?3, ?4)",
            params![src, kind, vocab, id],
        ),
    }?;
    Ok(())
}

/// Remove one edge. Removing one that is not there is not an error.
pub fn remove(
    connection: &Connection,
    src: i64,
    kind: &str,
    target: &Target,
) -> rusqlite::Result<()> {
    match target {
        Target::Object(dst) => connection.execute(
            "DELETE FROM edges WHERE src = ?1 AND kind = ?2 AND dst_object = ?3",
            params![src, kind, dst],
        ),
        Target::Term { vocab, id } => connection.execute(
            "DELETE FROM edges
             WHERE src = ?1 AND kind = ?2 AND dst_vocab = ?3 AND dst_term = ?4",
            params![src, kind, vocab, id],
        ),
    }?;
    Ok(())
}

/// Everything one object points at, optionally of one kind.
pub fn from(
    connection: &Connection,
    src: i64,
    kind: Option<&str>,
) -> rusqlite::Result<Vec<Edge>> {
    let mut statement = connection.prepare(
        "SELECT src, kind, dst_object, dst_vocab, dst_term FROM edges
         WHERE src = ?1 AND (?2 IS NULL OR kind = ?2)
         ORDER BY kind",
    )?;
    let edges = statement.query_map(params![src, kind], read_edge)?.collect();
    edges
}

/// Everything that points at one object.
pub fn to_object(
    connection: &Connection,
    dst: i64,
    kind: Option<&str>,
) -> rusqlite::Result<Vec<Edge>> {
    let mut statement = connection.prepare(
        "SELECT src, kind, dst_object, dst_vocab, dst_term FROM edges
         WHERE dst_object = ?1 AND (?2 IS NULL OR kind = ?2)
         ORDER BY kind",
    )?;
    let edges = statement.query_map(params![dst, kind], read_edge)?.collect();
    edges
}

/// Everything that points at one vocabulary term.
///
/// This is the reverse lookup the object model exists to make cheap: "what
/// fits Manuka?" is one hit on `edges_by_term`. It answers from what the
/// library holds, which is the question worth asking — a shop page lists every
/// avatar a product supports, and only some of those are owned.
pub fn to_term(
    connection: &Connection,
    vocab: &str,
    term: &str,
    kind: Option<&str>,
) -> rusqlite::Result<Vec<Edge>> {
    let mut statement = connection.prepare(
        "SELECT src, kind, dst_object, dst_vocab, dst_term FROM edges
         WHERE dst_vocab = ?1 AND dst_term = ?2 AND (?3 IS NULL OR kind = ?3)
         ORDER BY kind",
    )?;
    let edges = statement.query_map(params![vocab, term, kind], read_edge)?.collect();
    edges
}

/// How many objects point at a term. Cheaper than reading them when a term
/// listing only needs the count.
pub fn count_to_term(connection: &Connection, vocab: &str, term: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT count(*) FROM edges WHERE dst_vocab = ?1 AND dst_term = ?2",
        params![vocab, term],
        |row| row.get(0),
    )
}

fn exists(
    connection: &Connection,
    src: i64,
    kind: &str,
    target: &Target,
) -> rusqlite::Result<bool> {
    let count: i64 = match target {
        Target::Object(dst) => connection.query_row(
            "SELECT count(*) FROM edges WHERE src = ?1 AND kind = ?2 AND dst_object = ?3",
            params![src, kind, dst],
            |row| row.get(0),
        )?,
        Target::Term { vocab, id } => connection.query_row(
            "SELECT count(*) FROM edges
             WHERE src = ?1 AND kind = ?2 AND dst_vocab = ?3 AND dst_term = ?4",
            params![src, kind, vocab, id],
            |row| row.get(0),
        )?,
    };
    Ok(count > 0)
}

/// Read one row into an [`Edge`].
///
/// A row with neither target, or both, cannot exist: the CHECK on the table
/// refuses it. Reaching the fallback would mean the constraint was dropped, so
/// it reports that rather than inventing a target.
fn read_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<Edge> {
    let object: Option<i64> = row.get(2)?;
    let vocab: Option<String> = row.get(3)?;
    let term: Option<String> = row.get(4)?;

    let target = match (object, vocab, term) {
        (Some(id), None, None) => Target::Object(id),
        (None, Some(vocab), Some(id)) => Target::Term { vocab, id },
        _ => {
            return Err(rusqlite::Error::InvalidColumnType(
                2,
                "edge has no single target; the CHECK constraint is missing".into(),
                rusqlite::types::Type::Null,
            ));
        }
    };

    Ok(Edge { src: row.get(0)?, kind: row.get(1)?, target })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema;
    use crate::store::values::Values;

    /// A library with three objects and the avatar vocabulary seeded.
    fn library() -> (Connection, Vec<i64>) {
        let connection = schema::open_in_memory().expect("open");
        let mut values = Values::new();
        let objects: Vec<i64> = (0..3)
            .map(|_| values.create_object(&connection).expect("create"))
            .collect();

        for term in ["manuka", "selestia", "kikyo"] {
            connection
                .execute(
                    "INSERT INTO terms (vocab, id, label) VALUES ('avatar', ?1, ?1)",
                    params![term],
                )
                .expect("seed term");
        }
        (connection, objects)
    }

    fn avatar(id: &str) -> Target {
        Target::Term { vocab: "avatar".into(), id: id.into() }
    }

    // --- writing ----------------------------------------------------------

    #[test]
    fn an_edge_can_point_at_an_object() {
        let (connection, objects) = library();
        add(&connection, objects[0], "contains", &Target::Object(objects[1])).expect("add");

        let out = from(&connection, objects[0], None).expect("read");
        assert_eq!(out, [Edge {
            src: objects[0],
            kind: "contains".into(),
            target: Target::Object(objects[1]),
        }]);
    }

    #[test]
    fn an_edge_can_point_at_a_term() {
        let (connection, objects) = library();
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("add");

        let out = from(&connection, objects[0], None).expect("read");
        assert_eq!(out[0].target, avatar("manuka"));
    }

    #[test]
    fn adding_the_same_edge_twice_does_not_duplicate_it() {
        // A rescan reasserts what it found; that must not grow the table.
        let (connection, objects) = library();
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("first");
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("second");

        assert_eq!(from(&connection, objects[0], None).expect("read").len(), 1);
    }

    #[test]
    fn one_object_can_point_at_a_term_two_ways() {
        // supports and owned are different facts about the same pair.
        let (connection, objects) = library();
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("supports");
        add(&connection, objects[0], "owned", &avatar("manuka")).expect("owned");

        assert_eq!(from(&connection, objects[0], None).expect("read").len(), 2);
    }

    #[test]
    fn removing_an_edge_leaves_the_others() {
        let (connection, objects) = library();
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("a");
        add(&connection, objects[0], "supports", &avatar("kikyo")).expect("b");

        remove(&connection, objects[0], "supports", &avatar("manuka")).expect("remove");

        let left = from(&connection, objects[0], None).expect("read");
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].target, avatar("kikyo"));
    }

    #[test]
    fn removing_an_edge_that_is_not_there_is_quiet() {
        let (connection, objects) = library();
        remove(&connection, objects[0], "supports", &avatar("manuka")).expect("no-op");
    }

    #[test]
    fn edge_kinds_are_not_enumerated() {
        // A plugin inventing its own kind needs no change here.
        let (connection, objects) = library();
        for kind in ["contains", "requires", "supersedes", "cites", "remixes"] {
            add(&connection, objects[0], kind, &Target::Object(objects[1]))
                .unwrap_or_else(|e| panic!("{kind} rejected: {e}"));
        }
        assert_eq!(from(&connection, objects[0], None).expect("read").len(), 5);
    }

    // --- reverse lookup ---------------------------------------------------

    #[test]
    fn a_term_finds_everything_that_points_at_it() {
        // "What fits Manuka?" -- the query the object model exists to make
        // cheap.
        let (connection, objects) = library();
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("a");
        add(&connection, objects[1], "supports", &avatar("manuka")).expect("b");
        add(&connection, objects[2], "supports", &avatar("kikyo")).expect("c");

        let fits: Vec<i64> = to_term(&connection, "avatar", "manuka", None)
            .expect("reverse")
            .iter()
            .map(|edge| edge.src)
            .collect();

        assert_eq!(fits.len(), 2);
        assert!(fits.contains(&objects[0]));
        assert!(fits.contains(&objects[1]));
    }

    #[test]
    fn reverse_lookup_can_filter_by_kind() {
        let (connection, objects) = library();
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("a");
        add(&connection, objects[1], "owned", &avatar("manuka")).expect("b");

        let supported = to_term(&connection, "avatar", "manuka", Some("supports")).expect("q");
        assert_eq!(supported.len(), 1);
        assert_eq!(supported[0].src, objects[0]);
    }

    #[test]
    fn a_term_with_nothing_pointing_at_it_reads_empty() {
        // Selestia: referenced by nothing yet. Not an error state.
        let (connection, _) = library();
        assert!(to_term(&connection, "avatar", "selestia", None).expect("q").is_empty());
        assert_eq!(count_to_term(&connection, "avatar", "selestia").expect("count"), 0);
    }

    #[test]
    fn counting_matches_reading() {
        let (connection, objects) = library();
        add(&connection, objects[0], "supports", &avatar("manuka")).expect("a");
        add(&connection, objects[1], "supports", &avatar("manuka")).expect("b");

        let read = to_term(&connection, "avatar", "manuka", None).expect("read").len() as i64;
        assert_eq!(count_to_term(&connection, "avatar", "manuka").expect("count"), read);
    }

    #[test]
    fn objects_find_what_points_at_them() {
        let (connection, objects) = library();
        add(&connection, objects[0], "contains", &Target::Object(objects[2])).expect("a");
        add(&connection, objects[1], "contains", &Target::Object(objects[2])).expect("b");

        // One file can belong to a product and to a collection at once.
        let holders = to_object(&connection, objects[2], None).expect("reverse");
        assert_eq!(holders.len(), 2);
    }

    #[test]
    fn a_reverse_lookup_uses_its_index() {
        // Without the index this is a scan, and the whole one-table design
        // rests on it not being one.
        let (connection, _) = library();
        let plan: String = connection
            .query_row(
                "EXPLAIN QUERY PLAN
                 SELECT src, kind, dst_object, dst_vocab, dst_term FROM edges
                 WHERE dst_vocab = 'avatar' AND dst_term = 'manuka' AND kind = 'supports'",
                [],
                |row| row.get(3),
            )
            .expect("explain");
        assert!(plan.contains("edges_by_term"), "plan was: {plan}");
    }

    // --- target integrity -------------------------------------------------

    #[test]
    fn an_edge_to_a_missing_term_is_refused() {
        let (connection, objects) = library();
        let result = add(&connection, objects[0], "supports", &avatar("nobody"));
        assert!(result.is_err());
    }

    #[test]
    fn deleting_an_object_takes_the_edges_pointing_at_it() {
        let (connection, objects) = library();
        add(&connection, objects[0], "contains", &Target::Object(objects[1])).expect("add");

        connection
            .execute("DELETE FROM objects WHERE id = ?1", params![objects[1]])
            .expect("delete");

        assert!(from(&connection, objects[0], None).expect("read").is_empty());
    }

    #[test]
    fn a_row_with_no_single_target_is_reported_rather_than_guessed() {
        // The CHECK makes this unreachable in a real library. The branch
        // exists for the day a migration drops it, and a branch nobody has
        // ever run is a branch nobody knows works -- so this builds the table
        // without the constraint to reach it.
        let connection = Connection::open_in_memory().expect("open");
        connection
            .execute_batch(
                "CREATE TABLE edges (
                     src        INTEGER NOT NULL,
                     kind       TEXT    NOT NULL,
                     dst_object INTEGER,
                     dst_vocab  TEXT,
                     dst_term   TEXT
                 ) STRICT;
                 INSERT INTO edges (src, kind) VALUES (1, 'no target');
                 INSERT INTO edges (src, kind, dst_object, dst_vocab, dst_term)
                 VALUES (2, 'both', 9, 'avatar', 'manuka');",
            )
            .expect("a table without the CHECK");

        assert!(from(&connection, 1, None).is_err(), "an edge with no target read as one");
        assert!(from(&connection, 2, None).is_err(), "an edge with two targets read as one");
    }
}
