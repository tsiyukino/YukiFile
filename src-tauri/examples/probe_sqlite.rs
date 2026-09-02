fn main() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE t (a INTEGER PRIMARY KEY, b TEXT NOT NULL) STRICT;").unwrap();

    // integer literal into a TEXT column
    let r = c.execute("INSERT INTO t VALUES (1, 5)", []);
    println!("int -> TEXT      : {:?}", r.err().map(|e| e.to_string()));
    let got: Option<String> = c.query_row("SELECT b FROM t WHERE a=1", [], |r| r.get(0)).ok();
    println!("  stored as       : {got:?}");

    // text into an INTEGER column
    let r = c.execute("INSERT INTO t VALUES ('abc', 'x')", []);
    println!("text -> INTEGER  : {:?}", r.err().map(|e| e.to_string()));

    // a non-numeric string into INTEGER
    c.execute_batch("CREATE TABLE u (n INTEGER) STRICT;").unwrap();
    let r = c.execute("INSERT INTO u VALUES ('not a number')", []);
    println!("junk -> INTEGER  : {:?}", r.err().map(|e| e.to_string()));

    // what a non-STRICT table does with the same
    c.execute_batch("CREATE TABLE lax (n INTEGER);").unwrap();
    c.execute("INSERT INTO lax VALUES ('not a number')", []).unwrap();
    let t: String = c.query_row("SELECT typeof(n) FROM lax", [], |r| r.get(0)).unwrap();
    println!("lax table stores : {t}");
}
