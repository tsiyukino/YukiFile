# Primer for the design system, not a GitHub clone for the app

Date: 2026-09-01
Status: accepted

## Context

The intent was to copy GitHub wholesale — palette, components, layout — partly
for the look and partly because its pull request review flow is the right model
for our change sets.

Two things needed separating: what is legally available, and what is actually
appropriate for a library of visual assets.

## Legal position

Colour values are facts and not copyrightable. Layout conventions and
interaction patterns are functional. Neither is a problem.

GitHub's logo, the Octocat and the GitHub name are trademarks. Trademark
protection turns on whether users could be confused about who made the thing,
not on how closely the design resembles the original. Copying the overall
appearance far enough that the software reads as a GitHub product is the risk,
and it is a different risk from copyright.

None of this needs working around, because GitHub publishes its design system.
Primer — `@primer/primitives`, `@primer/react`, `@primer/octicons` — is MIT
licensed and free to use commercially with the licence notice retained. Using
the real thing is both easier and unambiguous.

(Not legal advice. Worth a professional check before commercial release.)

## Decision

Build on Primer: its colour tokens, spacing scale, components and icons. Light,
dark and high-contrast themes come with it, along with the accessibility work
already done.

Copy GitHub's *review* interaction directly — the change set screen is a diff
list with per-entry accept and discard, and an "accept additions only" bulk
action. That interaction is well suited to what change sets are, and there is
no reason to invent a worse version of it.

Do not copy GitHub's *browsing* interface. GitHub is tuned for scanning dense
text diffs; this application manages visual assets where recognition happens
through thumbnails. The main library view is a thumbnail grid with sidebar
filtering, designed against the actual task, and built from Primer components
so it sits visually alongside the review screens rather than looking like a
second application bolted on.

Do not use GitHub's marks: no logo, no Octocat, no use of the name.

## Quality bar

The interface is a primary requirement, not a finishing step. The library this
was built for is browsed visually — the original problem was not being able to
tell what anything was without opening it. An interface that is merely
functional fails the actual use case.

Concretely, this means: thumbnails are load-bearing and get designed around
rather than bolted on; density is tuned for recognition rather than for fitting
maximum rows on screen; and the light and dark themes are both first-class,
since Primer gives us no excuse for one being an afterthought.

## Consequences

Frontend depends on Primer. Its component set constrains some choices, which is
a reasonable trade for not maintaining a design system.

Two visual registers coexist — grid-based browsing and list-based review — held
together by shared tokens. If they start to feel like different products, the
tokens are being bypassed somewhere.
