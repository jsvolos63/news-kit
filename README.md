# @jfs/news-kit

Shared, dependency-free news primitives extracted from the JFS family of
buildless static apps (Surf-Tracker, BearsMockDraft, market-monitor,
JFS-Sports). Pure ESM, zero runtime dependencies, single-file bundle
(`index.js`).

## What's in it

| Module | Exports | Notes |
|---|---|---|
| decode-entities | `decodeEntities` | Numeric + common named entities; `&amp;` is decoded **last** so already-decoded ampersands are never re-interpreted. |
| escape | `escHtml`, `safeContentUrl`, `safeContentUrlAttr` | All-5-char HTML escaper plus the dual URL guards: `safeContentUrl` returns a normalized http(s) href for DOM APIs (`el.href = …`) or `null` on reject, `safeContentUrlAttr` returns an HTML-escaped href for `innerHTML` templates ('' on reject). |
| classify | `classify`, `makeClassifier`, `signalPriority`, `DEFAULT_SIGNALS`, `DEFAULT_PRIORITY` | Config-driven keyword classifier; each app supplies its own vocabulary. |
| parse | `parseFeed`, `looksLikeFeed`, `countItems` | RSS/Atom → normalized items. Uses `DOMParser` when available (browser), a linear-scan regex fallback otherwise (Node/serverless). Both paths return entity-decoded text exactly once. Input capped at 4 MB / 1000 items. |
| dedupe | `dedupeItems`, `mergeItems`, `normalizeTitle`, `stripPublisher`, `titleSignature`, `nearDuplicate`, `earliestDate` | Signature-based near-duplicate clustering (single-linkage, input capped at 2000 items) + merge-with-retention so a transient empty fetch can't blank the previous set. |
| proxy | `proxyRace`, `DEFAULT_PROXIES` | Race public CORS proxies with a delayed own-origin fallback; first usable body wins, losers aborted. Prefer an own-origin SSRF-guarded proxy long-term. |
| time | `relativeTime` | "just now" / "3m ago" / "2h ago" / "Jun 16"; `now` injectable for tests. |
| render-river | `renderNewsRiver`, `newsRiverCard`, `riverDayLabel`, `ensureNewsRiverStyles`, `dedupedNewsSummary`, `NEWS_RIVER_CSS` | The John's News river presentation: day-grouped article cards (source label + relative time + optional favicon/chip, FULL TEXT / DEEP LINK badge, serif headline, clamped summary, byline, lazy thumbnail, per-source accents). DOM-node rendering (feed text never parsed as HTML; URLs pass `safeContentUrl`). Styles install once via constructed stylesheet (CSP-safe) with a `<style>` fallback; themable through `--nk-*` variables declared at zero specificity. **Deep-link rule:** headlines with URLs stay plain anchors — `onOpen(item, e)` sees only unmodified left-clicks and returning `false` lets the tap navigate so iOS universal links open the publisher's own app (NYT, Economist, …). Deks are deduped by default: a summary that merely repeats the headline is dropped, and a body that opens by repeating it keeps only the trailing prose (`dedupedNewsSummary` is exported so apps with their own renderers share the policy; `opts.dedupeSummary === false` opts out). Browser-only. |
| sanitize-html | `sanitizeHtmlToFragment`, `isSafeContentUrl`, `isSafeSrcset` | Allowlist rebuild sanitizer for article readers, returning a `DocumentFragment`: ALLOWED kept, BLOCKED removed with subtree, unknown tags **unwrapped** (children kept). Browser-only (`sanitizeHtmlToFragment` throws without a DOM); the URL policy (`isSafeContentUrl`, `isSafeSrcset`) is pure and Node-testable, and injectable via `options.safeUrl`. |

Naming rule across the kit family: the generic DOM-safety names (`escapeHtml`,
`safeUrl`, `sanitizeUrl`, `sanitizeHref`, `sanitizeHtml`) belong to
`@jfs/dom-kit` with dom-kit's permissive contracts; news-kit's guards are
strict feed-content validators under content-scoped names, so the two kits
never export the same name with different contracts.

## Using it

Consumers pin the package by **commit SHA** and vendor it with the kit's own
CLI (`jfs-news-kit-vendor`), with the same invocation plus `--check` in CI
failing the build on drift. An ESM consumer copies the module verbatim
(`--format esm --out js/vendor/news-kit/index.js`); a classic-script consumer
takes an IIFE global, optionally narrowed to just what it uses, e.g.
BearsMockDraft's reader sanitizer
(`--format global --name NewsKitSanitize --pick
sanitizeHtmlToFragment,isSafeContentUrl
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
so the browser code paths (DOMParser feed parsing, sanitizeHtmlToFragment rebuild) are
exercised in CI.

## Versioning

Bump `version` in `package.json` for every change to `index.js`, and tag the
commit (`vX.Y.Z`). The `index.js` banner deliberately carries no version —
vendored copies get `v${pkg.version}` stamped by the shared vendor CLI. Consumers pin
SHAs, so nothing moves until they re-pin and run `npm run vendor:sync`.
