/**
 * What jsdom does not provide, and what has to happen between tests.
 *
 * Kept in one file rather than repeated per suite: a component test that
 * forgot the cleanup does not fail, it finds the previous test's elements and
 * asserts against them, which is the kind of green that hides a red.
 */

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom implements no media queries at all. Primer's theme asks for one on
// first render, so without this every component test throws before it can
// assert anything.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom leaves `adoptedStyleSheets` undefined on a document root. Primer's
// tooltip runs a popover polyfill that iterates it, so a component carrying a
// tooltip -- the list's chevron does -- throws asynchronously after the test
// it belongs to has already passed. That reads as an unhandled error attached
// to whichever test ran last, which is a report nobody can act on.
if (!(document as unknown as { adoptedStyleSheets?: unknown }).adoptedStyleSheets) {
  Object.defineProperty(document, "adoptedStyleSheets", {
    value: [],
    writable: true,
    configurable: true,
  });
}

// Testing Library only auto-cleans when vitest globals are on, and they are
// not: an explicit import says where a test's helpers came from.
afterEach(cleanup);
