# @jfs/news-kit

Shared, dependency-free news **and DOM** primitives extracted from the JFS
family of buildless static apps (Surf-Tracker, BearsMockDraft,
market-monitor, JFS-Sports, John's News, Bears Front Office). Pure ESM, zero
runtime dependencies, single-file bundle (`index.js`).

> **v0.12.0 absorbed `@jfs/dom-kit` and `@jfs/modal-kit`.** Both kits are
> being retired into this one, per the family's extraction bar (*prefer
> growing an existing kit over minting a new one*): dom-kit's 13 exports
> overlapped this kit's escaper and URL guards, and modal-kit was 554 lines
> behind effectively one public export. **Every name they exported is
> exported here, unchanged** — a consumer migrates by repointing its
> `vendor:sync` invocation at `jfs-news-kit-vendor`, not by editing call
> sites. The old repos remain in place until every consumer has moved.
> Because the vendoring CLI tree-shakes a narrowed build (`@jfs/vendor-cli`
> 0.11.0+), taking only `escapeHtml` from this kit costs ~5 KB, not the
> whole bundle — see [Vendored build sizes](#vendored-build-sizes).

## What's in it

| Module | Exports | Notes |
|---|---|---|
| decode-entities | `decodeEntities` | Numeric + common named entities; `&amp;` is decoded **last** so already-decoded ampersands are never re-interpreted. |
| escape | `escapeHtml`, `escHtml`, `escAttr`, `safeContentUrl` | ONE all-5-char HTML escaper under three names (dom-kit's `escapeHtml` and news-kit's `escHtml` were verified identical over 85,683 differential inputs and collapsed; `escAttr` is the third historical alias). Plus the strict URL guard: `safeContentUrl` returns a normalized http(s) href for DOM APIs (`node.href = …`) or `null` on reject. |
| classify | `classify`, `makeClassifier`, `signalPriority`, `DEFAULT_SIGNALS`, `DEFAULT_PRIORITY` | Config-driven keyword classifier; each app supplies its own vocabulary. |
| parse | `parseFeed`, `looksLikeFeed` | RSS/Atom → normalized items. Uses `DOMParser` when available (browser), a linear-scan regex fallback otherwise (Node/serverless). Both paths return entity-decoded text exactly once. Input capped at 4 MB / 1000 items. |
| dedupe | `dedupeItems`, `mergeItems`, `normalizeTitle`, `stripPublisher`, `titleSignature`, `nearDuplicate`, `earliestDate` | Signature-based near-duplicate clustering (single-linkage, input capped at 2000 items) + merge-with-retention so a transient empty fetch can't blank the previous set. |
| time | `relativeTime` | "just now" / "3m ago" / "2h ago" / "Jun 16"; `now` injectable for tests. |
| render-river | `renderNewsRiver`, `renderNewsRiverSkeletons`, `newsRiverCard`, `riverDayLabel`, `riverCoarseGroupLabel`, `ensureNewsRiverStyles`, `dedupedNewsSummary`, `isStandaloneDisplay`, `NEWS_RIVER_CSS` | The John's News river presentation: day-grouped article cards (source label + relative time + optional favicon/chip, FULL TEXT / DEEP LINK badge, serif headline, clamped summary, byline, lazy thumbnail, per-source accents). DOM-node rendering (feed text never parsed as HTML; URLs pass `safeContentUrl`). Styles install once via constructed stylesheet (CSP-safe) with a `<style>` fallback; themable through `--nk-*` variables declared at zero specificity. **Deep-link rule:** headlines with URLs stay plain anchors — `onOpen(item, e)` sees only unmodified left-clicks and returning `false` lets the tap navigate so iOS universal links open the publisher's own app (NYT, Economist, …). External links carry `target="_blank"` in a browser tab, but when the page runs as an installed app (standalone display, detected via `isStandaloneDisplay`, overridable with `opts.standalone`) they navigate the current context instead — `_blank` there spawns a launch window that outlives the universal-link handoff, stranding the reader on an orphaned window when they close the publisher's app. Deks are deduped by default: a summary that merely repeats the headline is dropped, and a body that opens by repeating it keeps only the trailing prose (`dedupedNewsSummary` is exported so apps with their own renderers share the policy; `opts.dedupeSummary === false` opts out). Cold loads paint `renderNewsRiverSkeletons` — fixed-height placeholder cards that reserve the river's space so the swap to content can't shift the page (skeletons are only for an empty river; cached/last-good items should stay visible through a refresh). Long-window feeds can swap the day labeler via `opts.groupLabel` (`riverCoarseGroupLabel`: Today / Yesterday / Earlier this week / Earlier this month / Older). Browser-only. |
| source-menu | `createSourceMenu`, `countBySource`, `ensureSourceMenuStyles`, `SOURCE_MENU_CSS` | The John's News / BearsMockDraft Sources sheet, extracted as the family's shared filter. Two controls per row that never share a code path: the source **name** drills down (session-only pin — the app closes its sheet on `reason === 'drill'`), the **checkbox** builds a localStorage-persisted multi-select (sheet stays open, refilters live). Rows sort busiest-first with per-source counts; persisted-but-absent sources render at count 0 so they can still be unchecked; storage failures degrade to "all sources". Container-agnostic: the app owns the modal/sheet, the kit renders the trigger button (`renderButton`) and rows (`renderMenu`) and answers `filterItems()`. |
| dom (absorbed from @jfs/dom-kit) | `safeUrl`, `safeImageUrl`, `sanitizeUrl`, `sanitizeHref`, `el`, `elem`, `byId`, `$`, `$$`, `sanitizeHtml` | The generic DOM-safety layer. **Four URL guards that are NOT interchangeable** — see [URL guards](#url-guards-six-contracts-not-one). `el(tag, attrs, ...children)` is the auto-escaping element builder (string children become text nodes, `on*` attribute names are refused, `on:` takes real listeners); `elem` is the Weather-compatible 3-arg wrapper; `byId` / `$` / `$$` are query shorthands. `sanitizeHtml(html)` is the STRING-returning whitelist sanitizer (small inline-formatting allowlist, blocked subtrees dropped, unknown tags unwrapped, `href` through `safeUrl` + `noopener`); it shares the family's policy-owned blocked-tag list with `sanitizeHtmlToFragment` rather than mirroring it. Browser-only. |
| modal (absorbed from @jfs/modal-kit) | `createModal`, `getFocusable`, `isAnyModalOpen`, `_resetModalsForTest` | Accessible dialog plumbing: focus trap + focus save/restore, iOS-safe `position:fixed` scroll-lock (reference-counted), a central Escape stack, marker-guarded depth-counted `inert`/`aria-hidden` siblings, bfcache (`pagehide`) cleanup, and an opt-in history sentinel so Back / iOS edge-swipe closes the topmost dialog. `createModal(el, opts)` returns `{ open, close, isOpen }`; `onOpen`/`onClose` receive `{ el }`. The shared document/window handlers are wired LAZILY on the first `open()` — importing the kit registers nothing, which is what keeps `"sideEffects": false` true. Browser-only at call time. |
| sanitize-html | `sanitizeHtmlToFragment`, `isSafeContentUrl`, `isSafeSrcset` | Allowlist rebuild sanitizer for article readers, returning a `DocumentFragment`: ALLOWED kept, BLOCKED removed with subtree, unknown tags **unwrapped** (children kept). Browser-only (`sanitizeHtmlToFragment` throws without a DOM); the URL policy (`isSafeContentUrl`, `isSafeSrcset`) is pure and Node-testable, and injectable via `options.safeUrl` for readers that need a stricter per-URL policy than the permissive default `isSafeContentUrl`. |

### URL guards: six contracts, not one

The merge brought six URL guards into one file. **None of them are
interchangeable**, and a differential run found all fifteen pairs differing
on real inputs, so they each kept their own implementation:

| Guard | Returns | Rejects to | Allows |
|---|---|---|---|
| `safeUrl(u)` | string | `"#"` | http(s), `mailto:`, protocol-relative (→ `https:`), relative `/` `#` `?` |
| `safeImageUrl(u)` | string | `""` | http(s), protocol-relative (→ `https:`), `blob:`, `data:image/*`. **No relative paths.** `<img src>` ONLY — never `<object>`/`<embed>`/`<iframe>` |
| `sanitizeUrl(u)` | string, **HTML-escaped** | `""` | `new URL()` + http(s) only. For innerHTML interpolation |
| `sanitizeHref(u)` | string, verbatim | `""` | `new URL()` + http(s) only. For `setAttribute` / `.href` / `.src` |
| `safeContentUrl(u)` | string \| `null` | `null` | as `sanitizeHref`, but **requires a string input** |
| `isSafeContentUrl(u)` | boolean | `false` | permissive feed-content predicate: absolute http(s), protocol-relative, root-relative **and bare relative text** |

Worked examples of the divergence:

| input | `safeUrl` | `safeImageUrl` | `sanitizeUrl` | `sanitizeHref` | `safeContentUrl` | `isSafeContentUrl` |
|---|---|---|---|---|---|---|
| `//evil.com/x` | `https://evil.com/x` | `https://evil.com/x` | `""` | `""` | `null` | `true` |
| `/root/rel` | `/root/rel` | `""` | `""` | `""` | `null` | `true` |
| `mailto:a@b.c` | `mailto:a@b.c` | `""` | `""` | `""` | `null` | `false` |
| `data:image/png;base64,…` | `"#"` | kept | `""` | `""` | `null` | `false` |
| `http://x/?a=1&b=2` | verbatim | verbatim | `…&amp;b=2` | `…&b=2` | `…&b=2` | `true` |

`test/escape-dedup.test.js` pins every row. Do not unify them.

All of them strip C0 controls + DEL before the scheme test, from the ONE
policy-owned `URL_CONTROL_CHARS` regex (`family/sanitizer-policy.json` in
`@jfs/vendor-cli`, synced by `npm run policy:sync`). The blocked-tag list is
likewise policy-owned once: `DEFAULT_BLOCKED` (uppercase, for
`sanitizeHtmlToFragment`) is the marked region, and `sanitizeHtml`'s
lowercase set is derived from it, so the two can no longer drift.

### Vendored build sizes

Generated from v0.12.0 with `@jfs/vendor-cli` 0.11.0 (`--format global`,
unminified, comments included):

| Pick | Bytes |
|---|---|
| `escapeHtml` | 5,512 |
| `createModal` | 27,659 |
| `NewsKitSanitize` + `NewsKitRiver` (Surf-Tracker's two globals) | 38,962 |
| sanitize + river + source-menu + `createModal` + `escapeHtml` | 81,791 |
| full 50-export surface (unshaken) | 114,378 |

Every narrowed build keeps the sanitizer-policy marked regions, so
`jfs-sanitizer-policy-sync --check` still gates the vendored copy.

## Using it

Consumers pin the package by **commit SHA** and vendor it with the kit's own
CLI (`jfs-news-kit-vendor`), with the same invocation plus `--check` in CI
failing the build on drift. An ESM consumer copies the module verbatim
(`--format esm --out js/vendor/news-kit/index.js`); a classic-script consumer
takes an IIFE global, optionally narrowed to just what it uses, e.g.
BearsMockDraft's reader sanitizer
(`--format global --name NewsKitSanitize --pick
sanitizeHtmlToFragment,isSafeContentUrl
--out js/vendor/news-kit/sanitize-html.js`).

A page that needs **several** narrowed globals from this kit should vendor
them from ONE file with the repeatable `--global Name[:pick,list]` flag —
the kit body is emitted once and each global's surface map closes over it,
instead of shipping the whole bundle once per global:

```
jfs-news-kit-vendor --format global \
  --global NewsKitSanitize:sanitizeHtmlToFragment,isSafeContentUrl \
  --global NewsKitRiver:renderNewsRiver,renderNewsRiverSkeletons,ensureNewsRiverStyles \
  --out docs/js/vendor/news-kit.global.js
```

(`--global X:a,b` emits byte-identical output to `--name X --pick a,b`, so
existing single-global invocations are unaffected.)

### Migrating off @jfs/dom-kit / @jfs/modal-kit

Both kits' exports live here unchanged, so migration is a **vendoring**
change, not a code change: drop the old pin, point the `vendor:sync` script
at `jfs-news-kit-vendor` with the same picks, and leave the call sites alone.

```
# was: jfs-dom-kit-vendor   --format global --name JfsDomKit --pick escapeHtml …
jfs-news-kit-vendor --format global --name JfsDomKit --pick escapeHtml \
  --out js/vendor/dom-kit/dom-kit.global.js

# was: jfs-modal-kit-vendor --format global --name ModalKit --pick createModal …
jfs-news-kit-vendor --format global --name ModalKit --pick createModal \
  --out js/vendor/modal-kit/modal-kit.global.js
```

A page taking several of these should collapse them into one file with
repeatable `--global`, which emits the kit body once:

```
jfs-news-kit-vendor --format global \
  --global NewsKitSanitize:sanitizeHtmlToFragment,isSafeContentUrl \
  --global NewsKitRiver:renderNewsRiver,decodeEntities \
  --global NewsKitSourceMenu:createSourceMenu,countBySource \
  --global ModalKit:createModal \
  --global JfsDomKit:escapeHtml \
  --out js/vendor/jfs-kits.global.js
```

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
the DOM-dependent test files (`test/*-dom.test.js`, `test/dom.test.js`) or
constructed per-test (`test/modal.test.js`) before the kit is imported, so the
browser code paths (DOMParser feed parsing, both sanitizers, the river and
source-menu renderers, the focus trap / scroll-lock / Escape stack) are
exercised in CI. `test/side-effects.test.js` deliberately runs with NO DOM
globals — it is what proves `"sideEffects": false`.

## Versioning

Bump `version` in `package.json` for every change to `index.js`, and tag the
commit (`vX.Y.Z`). The `index.js` banner deliberately carries no version —
vendored copies get `v${pkg.version}` stamped by the shared vendor CLI. Consumers pin
SHAs, so nothing moves until they re-pin and run `npm run vendor:sync`.
