# The network is lent to a press

Date: 2026-10-24
Status: accepted

## Context

`docs.yml`: offline is the default, and network calls happen only when the
user presses a button. `plugin::commands` enforces half of that with a test
that refuses any plugin-callable command whose name reaches outside. The
other half — that pressing a button is what reaches outside — had no shape,
because nothing reached outside at all.

A Booth listing has a title, a price, a shop and a picture, and the VRChat
plugin needs to fetch them. A plugin is not a button.

## Decision

`http.get` and `cover.fetch` are commands on `APP_ONLY`: the application's
own, never a plugin's. The plugin host hands a plugin a `PressedApi` — the
ordinary api plus those two — only while an action the person pressed is
running, an object action or a library action, and only for the hosts the
plugin's manifest names under `contributes.hosts`. A panel drawing gets the
ordinary api and cannot reach outside.

What comes back is text, or a picture stored as a cover. Whatever a plugin
learns goes through `import.propose` like any other source: into empty fields
at once, into a change set where a person already chose.

## Why lend rather than grant

Granting `http.get` to plugins would put it on the list the network test
refuses, and rightly: a panel that fetched on every draw would make the
library's pages depend on a shop being up. Lending it for a press keeps the
rule where a person can see it — the button — and keeps the test.

## Why hosts are declared

A URL carries data. A plugin that can read values and reach any host can send
them anywhere. Naming the hosts in the manifest makes what a plugin can talk
to one line in review, the same way `ALLOWED` makes what a plugin can call one
array. `*.booth.pm` is a shop's own subdomain; `booth.pm.evil.example` is
not.

## What stays out

Cookies, sessions, logins, POST. The VRCAL browser-in-app pattern that logs
into Booth is a different product. One GET over HTTPS with a timeout and a
size cap is what pressing a button means here.

## Consequences

The manifest gains `action_module` and `hosts`; the plugin host gains the
object action slot, drawn as buttons in a property's region. The VRChat
plugin's **fetch listing** is the first consumer, and the first thing in the
application that has ever reached the network.
