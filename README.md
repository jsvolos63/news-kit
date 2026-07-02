# @jfs/news-kit

Shared, dependency-free news primitives extracted from the JFS family of
buildless static apps (Surf-Tracker, BearsMockDraft, market-monitor,
JFS-Sports). Pure ESM, zero runtime dependencies, single-file bundle
(`index.js`).

## What's in it

| Module | Exports | Notes |
|---|---|---|
| decode-entities | `decodeEntities` | Numeric + common named entities; `&amp;` is decoded **last** so already-decoded ampersands are never re-interpreted. |
| escape | `escHtml` / `escapeHtml`, `safeUrl` / `sanitizeHref`, `safeUrlAttr` / `sanitizeUrl` | All-5-char HTML escaper plus the dual URL guards: `safeUrl` returns a normalized href for DOM APIs (`el.href = …`), `safeUrlAttr` returns an HTML-escaped href for `innerHTML` templates. |
| classify | `classify`, `makeClassifier`, `signalPriority`, `DEFAULT_SIGNALS`, `DEFAULT_PRIORITY` | Config-driven keyword classifier; each app supplies its own vocabulary. |
| parse | `parseFeed`, `looksLikeFeed`, `countItems` | RSS/Atom → normalized items. Uses `DOMParser` when available (browser), a linear-scan regex fallback otherwise (Node/serverless). Both paths return entity-decoded text exactly once. Input capped at 4 MB / 1000 items. |
| dedupe | `dedupeItems`, `mergeItems`, `normalizeTitle`, `stripPublisher`, `titleSignature`, `nearDuplicate`, `earliestDate` | Signature-based near-duplicate clustering (single-linkage, input capped at 2000 items) + merge-with-retention so a transient empty fetch can't blank the previous set. |
| proxy | `proxyRace`, `DEFAULT_PROXIES` | Race public CORS proxies with a delayed own-origin fallback; first usable body wins, losers aborted. Prefer an own-origin SSRF-guarded proxy long-term. |
| time | `relativeTime` | "just now" / "3m ago" / "2h ago" / "Jun 16"; `now` injectable for tests. |
| sanitize-html | `sanitizeHtml`, `isSafeContentUrl`, `isSafeSrcset` | Allowlist rebuild sanitizer for article readers: ALLOWED kept, BLOCKED removed with subtree, unknown tags **unwrapped** (children kept). Browser-only (`sanitizeHtml` throws without a DOM); the URL policy (`isSafeContentUrl`, `isSafeSrcset`) is pure and Node-testable, and injectable via `options.safeUrl`. |

## Using it

Consumers pin the package by **commit SHA** and vendor it with the kit's own
CLI (`jfs-news-kit-vendor`), with the same invocation plus `--check` in CI
failing the build on drift. An ESM consumer copies the module verbatim
(`--format esm --out js/vendor/news-kit/index.js`); a classic-script consumer
takes an IIFE global, optionally narrowed to just what it uses, e.g.
BearsMockDraft's reader sanitizer
(`--format global --name NewsKitSanitize --pick sanitizeHtml,isSafeContentUrl
--out js/vendor/news-kit/sanitize-html.js`):

```json
"devDependencies": {
  "@jfs/news-kit": "github:jsvolos63/news-kit#<commit-sha>"
}
```

## Tests

```
npm install   # jsdom is a devDependency for the DOM-path tests only
npm test      # node --test
```

`index.js` itself imports nothing; jsdom is installed on `globalThis` inside
the DOM-dependent test files (`test/*-dom.test.js`) before the kit is imported,
so the browser code paths (DOMParser feed parsing, sanitizeHtml rebuild) are
exercised in CI.

## Versioning

Bump `version` in `package.json` and the header comment in `index.js` together
for every change to `index.js`, and tag the commit (`vX.Y.Z`). Consumers pin
SHAs, so nothing moves until they re-pin and run `npm run vendor:sync`.
