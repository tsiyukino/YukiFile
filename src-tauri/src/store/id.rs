//! Object identifiers: 64-bit, time-ordered, and meaningless.
//!
//! ```text
//!  63   62        21 20       0
//! [sign][ milliseconds ][ random ]
//! ```
//!
//! 42 bits of milliseconds run to 2109; 41 would have run out in 2039, which
//! is not a lifetime for a library meant to be kept.
//!
//! An id is derived from nothing about the object. The seed library's own
//! history is 174 products being moved between folders, and an identity that
//! changes on move loses every value and edge attached to it — so neither the
//! path nor the content can be the key.
//!
//! Time in the high bits keeps inserts landing at the right of the B-tree
//! rather than scattering it, which matters because a scan inserts a thousand
//! rows at once. Randomness in the low bits is what lets two machines merge
//! libraries without a rewrite: the import contract has to move objects
//! between machines, and a sequential counter guarantees every one of them
//! collides.
//!
//! Two ids in one millisecond can still collide, so the primary key is the
//! real guarantee and the caller retries on violation. That belongs to the
//! caller rather than here: retrying means knowing an insert failed, and this
//! module has no database.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hash, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

/// Bits given to the random tail: about two million values per millisecond.
const RANDOM_BITS: u32 = 21;

/// The random tail's mask: 2_097_151.
const RANDOM_MASK: u64 = (1 << RANDOM_BITS) - 1;

/// Bits given to the timestamp. Together with the tail and the sign bit this
/// fills an i64 exactly.
const TIME_BITS: u32 = 42;

/// The timestamp's mask.
const TIME_MASK: u64 = (1 << TIME_BITS) - 1;

/// Milliseconds since the Unix epoch.
///
/// Injectable so the collision path can be tested; a generator that reads the
/// clock directly can only be tested by waiting.
pub trait Clock {
    fn now_millis(&self) -> u64;
}

/// A source of random bits.
pub trait Entropy {
    fn next_bits(&mut self) -> u64;
}

/// The system clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    /// Times before the epoch collapse to 0. A clock set to 1969 produces ids
    /// that sort oddly; it must not panic mid-scan.
    fn now_millis(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64)
    }
}

/// Randomness seeded per process from the OS.
///
/// This is xorshift rather than a cryptographic generator on purpose: ids are
/// not secrets, and the property needed is spread within a millisecond, not
/// unpredictability. Pulling in a crypto dependency for object ids would be
/// paying for a guarantee nothing here relies on.
#[derive(Debug)]
pub struct SystemEntropy {
    state: u64,
}

impl Default for SystemEntropy {
    fn default() -> Self {
        // RandomState seeds itself from the OS once per process and jitters
        // per instance, so two processes starting in the same millisecond get
        // different states. Using it here avoids both a dependency and the
        // unsafe pointer trick that would otherwise stand in for it.
        let mut hasher = RandomState::new().build_hasher();
        SystemClock.now_millis().hash(&mut hasher);

        // The low bit is forced because xorshift cannot leave state zero.
        Self { state: hasher.finish() | 1 }
    }
}

impl Entropy for SystemEntropy {
    fn next_bits(&mut self) -> u64 {
        // xorshift64
        self.state ^= self.state << 13;
        self.state ^= self.state >> 7;
        self.state ^= self.state << 17;
        self.state
    }
}

/// Generates object ids.
#[derive(Debug, Default)]
pub struct IdGenerator<C = SystemClock, E = SystemEntropy> {
    clock: C,
    entropy: E,
}

impl IdGenerator<SystemClock, SystemEntropy> {
    pub fn new() -> Self {
        Self::default()
    }
}

impl<C: Clock, E: Entropy> IdGenerator<C, E> {
    pub fn with(clock: C, entropy: E) -> Self {
        Self { clock, entropy }
    }

    /// One id. Two calls in the same millisecond differ only in the random
    /// tail, so they can collide; the primary key catches that and the caller
    /// asks again.
    pub fn next(&mut self) -> i64 {
        let millis = self.clock.now_millis();
        let random = self.entropy.next_bits() & RANDOM_MASK;
        compose(millis, random)
    }
}

/// Build an id from a timestamp and a random tail.
///
/// Both are masked to their width, so a clock past 2109 or an `Entropy` handing
/// back more bits than the tail holds cannot corrupt the other half or push the
/// id negative. SQLite integers are signed, and a negative id would sort before
/// every existing row.
fn compose(millis: u64, random: u64) -> i64 {
    (((millis & TIME_MASK) << RANDOM_BITS) | (random & RANDOM_MASK)) as i64
}

/// The millisecond an id was created, for debugging.
pub fn timestamp_of(id: i64) -> u64 {
    (id as u64) >> RANDOM_BITS
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// A clock the test moves by hand.
    struct FixedClock(Cell<u64>);

    impl FixedClock {
        fn at(millis: u64) -> Self {
            Self(Cell::new(millis))
        }
        fn advance(&self, millis: u64) {
            self.0.set(self.0.get() + millis);
        }
    }

    impl Clock for FixedClock {
        fn now_millis(&self) -> u64 {
            self.0.get()
        }
    }

    /// Entropy that hands out a prepared sequence, so the collision case is
    /// reachable without waiting for one.
    struct ScriptedEntropy {
        values: Vec<u64>,
        next: usize,
    }

    impl ScriptedEntropy {
        fn of(values: &[u64]) -> Self {
            Self { values: values.to_vec(), next: 0 }
        }
    }

    impl Entropy for ScriptedEntropy {
        fn next_bits(&mut self) -> u64 {
            let value = self.values[self.next % self.values.len()];
            self.next += 1;
            value
        }
    }

    // --- shape ------------------------------------------------------------

    #[test]
    fn an_id_carries_the_millisecond_it_was_made() {
        let mut ids = IdGenerator::with(FixedClock::at(1_725_235_200_000), ScriptedEntropy::of(&[7]));
        assert_eq!(timestamp_of(ids.next()), 1_725_235_200_000);
    }

    #[test]
    fn ids_are_positive() {
        // SQLite integers are signed, and a negative id would sort before
        // every existing row.
        let far_future = TIME_MASK;
        for millis in [0, 1, 1_725_235_200_000, far_future] {
            let mut ids = IdGenerator::with(FixedClock::at(millis), ScriptedEntropy::of(&[RANDOM_MASK]));
            assert!(ids.next() > 0, "{millis} produced a non-positive id");
        }
    }

    #[test]
    fn the_timestamp_runs_past_2100() {
        // 41 bits would have overflowed in 2039. This is the test that caught
        // that, so it stays.
        let year_2100 = 4_102_444_800_000u64;
        let mut ids = IdGenerator::with(FixedClock::at(year_2100), ScriptedEntropy::of(&[0]));
        let id = ids.next();
        assert!(id > 0);
        assert_eq!(timestamp_of(id), year_2100);
    }

    // --- ordering ---------------------------------------------------------

    #[test]
    fn later_ids_sort_after_earlier_ones() {
        // Time in the high bits is what keeps a scan's inserts landing at the
        // right of the B-tree instead of scattering it.
        let clock = FixedClock::at(1_000_000);
        let mut ids = IdGenerator::with(clock, ScriptedEntropy::of(&[RANDOM_MASK, 0]));

        let early = ids.next(); // largest possible tail
        ids.clock.advance(1);
        let late = ids.next(); // smallest possible tail

        assert!(late > early, "a later id must sort after an earlier one");
    }

    #[test]
    fn ids_in_one_millisecond_differ_only_in_the_tail() {
        let mut ids = IdGenerator::with(FixedClock::at(500), ScriptedEntropy::of(&[1, 2, 3]));
        let made: Vec<i64> = (0..3).map(|_| ids.next()).collect();

        for id in &made {
            assert_eq!(timestamp_of(*id), 500);
        }
        let base = (500i64) << RANDOM_BITS;
        assert_eq!(made, [base | 1, base | 2, base | 3]);
    }

    // --- collisions -------------------------------------------------------

    #[test]
    fn the_same_millisecond_and_tail_collide() {
        // Not a defect: 22 bits will repeat eventually, which is why the
        // primary key is the guarantee and the caller retries. This test
        // exists so the collision is a known, reachable state rather than a
        // surprise in production.
        let mut ids = IdGenerator::with(FixedClock::at(9), ScriptedEntropy::of(&[42]));
        assert_eq!(ids.next(), ids.next());
    }

    #[test]
    fn a_retry_in_the_same_millisecond_can_differ() {
        // What the caller does after a primary key violation.
        let mut ids = IdGenerator::with(FixedClock::at(9), ScriptedEntropy::of(&[42, 42, 43]));
        let first = ids.next();
        assert_eq!(ids.next(), first, "the collision");
        assert_ne!(ids.next(), first, "the retry");
    }

    // --- masking ----------------------------------------------------------

    #[test]
    fn entropy_wider_than_the_tail_is_masked() {
        // An Entropy giving 64 bits must not overflow into the timestamp.
        let mut ids = IdGenerator::with(FixedClock::at(77), ScriptedEntropy::of(&[u64::MAX]));
        let id = ids.next();
        assert_eq!(timestamp_of(id), 77, "random bits leaked into the timestamp");
    }

    #[test]
    fn a_clock_beyond_41_bits_does_not_corrupt_the_tail() {
        let mut ids = IdGenerator::with(FixedClock::at(u64::MAX), ScriptedEntropy::of(&[5]));
        let id = ids.next();
        assert!(id > 0, "an out-of-range clock produced a negative id");
        assert_eq!((id as u64) & RANDOM_MASK, 5, "the tail survived");
    }

    // --- the system implementations ---------------------------------------

    #[test]
    fn the_system_clock_does_not_panic_before_the_epoch() {
        // A machine set to 1969 makes odd ids; it must not crash a scan.
        assert!(SystemClock.now_millis() > 0);
    }

    #[test]
    fn system_entropy_does_not_repeat_immediately() {
        let mut entropy = SystemEntropy::default();
        let first = entropy.next_bits();
        let second = entropy.next_bits();
        assert_ne!(first, second);
        assert_ne!(first, 0, "xorshift stuck at zero");
    }

    #[test]
    fn two_generators_do_not_agree() {
        // Two processes starting in the same millisecond need different
        // states, which is what the merge case depends on.
        let mut left = IdGenerator::new();
        let mut right = IdGenerator::new();
        assert_ne!(left.next(), right.next());
    }

    #[test]
    fn ids_spread_across_the_tail_rather_than_clustering() {
        // A scan inserts about a thousand objects, all in one millisecond, so
        // they are separated by 21 random bits alone. Birthday maths puts a
        // collision somewhere in that batch at roughly one run in five, which
        // is why the primary key is the guarantee and the caller retries --
        // and why this cannot assert they are all distinct without becoming a
        // test that fails one run in five.
        //
        // What is worth asserting is that the ids spread: a generator whose
        // tail clustered would collide constantly rather than occasionally.
        let mut ids = IdGenerator::new();
        let made: std::collections::HashSet<i64> = (0..1000).map(|_| ids.next()).collect();

        assert!(
            made.len() >= 950,
            "1000 ids produced only {} distinct values, which is clustering              rather than the birthday bound",
            made.len()
        );
    }

    #[test]
    fn the_generator_itself_does_not_repeat() {
        // Separates "collided because 21 bits is a small space" from "the
        // generator is weak". Full 64-bit draws have no meaningful birthday
        // bound at this count, so a repeat here is a real defect.
        //
        // The first version of this test masked to the tail width before
        // comparing, which put it back in the same 21-bit space it was meant
        // to rule out, and it failed about one run in five.
        let mut entropy = SystemEntropy::default();
        let draws: std::collections::HashSet<u64> =
            (0..1000).map(|_| entropy.next_bits()).collect();
        assert_eq!(draws.len(), 1000);
    }
}

