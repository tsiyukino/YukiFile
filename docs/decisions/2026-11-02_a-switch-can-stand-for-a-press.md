# A switch can stand for a press

Date: 2026-11-02
Status: accepted
Revises `2026-10-24_the-network-is-lent-to-a-press.md`

## Context

The network was lent to a press: a plugin held `httpGet` and `coverFetch`
only while an action a person pressed was running. Fetching a Booth listing
was a button on one object, and then a library action that pressed that
button for every listing.

The person the library is built for asked for Booth covers to arrive by
themselves. The problem the application exists to solve is not knowing what
one owns, and a product with a shop listing has the best possible cover one
request away. Pressing a menu item after every scan to get it is the
application making a person do its bookkeeping.

`docs.yml` says network calls happen only when the user presses a button.
The intent behind that line is that nothing reaches the network unless the
person decided it should. A press is one way to decide; it is not the only
one.

## Decision

A plugin may list library actions that are allowed to run by themselves
(`automatic_actions` in its manifest; each must also be a library action).
Listing one does not make it run. A library runs it only after a person
switches it on in that library's settings, and the switch is the consent the
press used to be.

- **Off by default**, per action, per library. A new library, or a library
  someone else made, reaches nothing until its owner says so.
- **The same lending.** An action running by itself is handed the same api a
  press would hand it: the network for the hosts its manifest named, and no
  other.
- **Visible while it runs.** The header says what is running and how far it
  has got, and a banner says what it did.
- **When it runs:** once when the library opens, and after the things that
  bring in new work: a scan or other library action, an import, an object
  added by hand, the switch being turned on. Not on every edit.

## Consequences

`docs.yml`'s rule now reads as "only when the user decided": a press, or a
switch the user turned on for this library. A plugin still cannot reach the
network on its own initiative; the allowlist test that refuses network
commands to plugins is unchanged.

The switch is a library setting, `auto.<plugin>.<action>`, kept with the
library like the theme, so a library copied to another machine keeps its
owner's decision.

The first consumer is the VRChat plugin's **fetch booth listings**, which
fetches each recorded listing not fetched yet, one request a second.
