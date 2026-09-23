# @jfs/news-kit

Shared, dependency-free news **and DOM** primitives extracted from the JFS
family of static apps, and vendored today by six of them (Surf-Tracker,
BearsMockDraft, market-monitor, JFS-Sports, John's News, Art-Gallery-). Pure
ESM, zero runtime dependencies, single-file bundle (`index.js`).

> **v0.12.0 absorbed `@jfs/dom-kit` and `@jfs/modal-kit`.** Both kits were
> retired into this one, per the family's extraction bar (*prefer
> growing an existing kit over minting a new one*): dom-kit's 13 exports
> overlapped this kit's escaper and URL guards, and modal-kit was 554 lines
> behind effectively one public export. **Every name they exported is
> exported here, unchanged** — a consumer migrates by repointing its
> `vendor:sync` invocation at `jfs-news-kit-vendor`, not by editing call
> sites. Both old repos are now ARCHIVED on GitHub — every consumer has
> moved, and neither pin exists anywhere in the family.
> Because the vendoring CLI tree-shakes a narrowed build (`@jfs/vendor-cli`
> 0.11.0+ for `global`/`cjs`, 0.12.0+ for `esm`), taking only `escapeHtml`
> from this kit costs under 2 KB, not the whole ~118 KB — see
> [Vendored build sizes](#vendored-build-sizes).

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
| dom (absorbed from @jfs/dom-kit) | `safeUrl`, `safeImageUrl`, `el`, `elem`, `byId`, `$`, `$$`, `sanitizeHtml` | The generic DOM-safety layer. **The URL guards are NOT interchangeable** — see [URL guards](#url-guards-four-contracts-not-one). `el(tag, attrs, ...children)` is the auto-escaping element builder (string children become text nodes; `on*` attribute names and `srcdoc` are refused outright, and a URL-bearing attribute — `href`, `src`, `formaction`, `xlink:href`, the rest of the sanitizer's URL-attribute set — is skipped when its value's scheme is `javascript:`/`vbscript:`, control characters stripped first; `on:` takes real listeners). That scheme test is NOT `safeUrl` — relative hrefs, `#` anchors and `data:image` sources still pass through verbatim; `elem` is the Weather-compatible 3-arg wrapper; `byId` / `$` / `$$` are query shorthands. `sanitizeHtml(html)` is the STRING-returning whitelist sanitizer (small inline-formatting allowlist, blocked subtrees dropped, unknown tags unwrapped, `href` through `safeUrl` + `noopener`); it shares the family's policy-owned blocked-tag list with `sanitizeHtmlToFragment` rather than mirroring it. Browser-only. |
| modal (absorbed from @jfs/modal-kit) | `createModal`, `getFocusable`, `isAnyModalOpen`, `_resetModalsForTest` | Accessible dialog plumbing: focus trap + focus save/restore, iOS-safe `position:fixed` scroll-lock (reference-counted), a central Escape stack, marker-guarded depth-counted `inert`/`aria-hidden` siblings, bfcache (`pagehide`) cleanup, and an opt-in history sentinel so Back / iOS edge-swipe closes the topmost dialog. `createModal(el, opts)` returns `{ open, close, isOpen }`; `onOpen`/`onClose` receive `{ el }`. The shared document/window handlers are wired LAZILY on the first `open()` — importing the kit registers nothing, which is what keeps `"sideEffects": false` true. Browser-only at call time. |
| sanitize-html | `sanitizeHtmlToFragment`, `isSafeContentUrl`, `isSafeSrcset` | Allowlist rebuild sanitizer for article readers, returning a `DocumentFragment`: ALLOWED kept, BLOCKED removed with subtree, unknown tags **unwrapped** (children kept). Browser-only (`sanitizeHtmlToFragment` throws without a DOM); the URL policy (`isSafeContentUrl`, `isSafeSrcset`) is pure and Node-testable, and injectable via `options.safeUrl` for readers that need a stricter per-URL policy than the permissive default `isSafeContentUrl`. |

### URL guards: four contracts, not one

Four URL guards live in this kit. **None of them are interchangeable**, and
a differential run found every pair differing on real inputs, so they each
keep their own implementation:

| Guard | Returns | Rejects to | Allows |
|---|---|---|---|
| `safeUrl(u)` | string | `"#"` | http(s), `mailto:`, protocol-relative (→ `https:`), relative `/` `#` `?` |
| `safeImageUrl(u)` | string | `""` | http(s), protocol-relative (→ `https:`), `blob:`, `data:image/*`. **No relative paths.** `<img src>` ONLY — never `<object>`/`<embed>`/`<iframe>` |
| `safeContentUrl(u)` | string \| `null` | `null` | `new URL()` + http(s) only, normalized href, **requires a string input**. The river renderer's own guard |
| `isSafeContentUrl(u)` | boolean | `false` | permissive feed-content predicate: absolute http(s), protocol-relative, root-relative **and bare relative text** |

Worked examples of the divergence:

| input | `safeUrl` | `safeImageUrl` | `safeContentUrl` | `isSafeContentUrl` |
|---|---|---|---|---|
| `//evil.com/x` | `https://evil.com/x` | `https://evil.com/x` | `null` | `true` |
| `/root/rel` | `/root/rel` | `""` | `null` | `true` |
| `mailto:a@b.c` | `mailto:a@b.c` | `""` | `null` | `false` |
| `data:image/png;base64,…` | `"#"` | kept | `null` | `false` |

`test/escape-dedup.test.js` pins every cell. Do not unify them.

Two more guards — `sanitizeUrl` (HTML-escaped normalized href, for innerHTML
interpolation) and `sanitizeHref` (the same, verbatim, for
`setAttribute`/`.href`/`.src`) — were retired to their single consumer in
v0.13.0: only JFS-Sports ever imported them and nothing in the kit called
them, so they live as app-owned copies in its `helpers.js`. Don't re-add
them without a second consumer.

All three http(s) guards strip USERINFO: `https://nytimes.com@evil.com/x`
comes back as `https://evil.com/x`, because a link that reads as one host and
resolves to another is the whole of that trick. A URL without credentials is
returned byte-identical — no re-normalization of the ordinary case.

All of them strip C0 controls + DEL before the scheme test, from the ONE
policy-owned `URL_CONTROL_CHARS` regex (`family/sanitizer-policy.json` in
`@jfs/vendor-cli`, synced by `npm run policy:sync`). The blocked-tag list is
likewise policy-owned once: `DEFAULT_BLOCKED` (uppercase, for
`sanitizeHtmlToFragment`) is the marked region, and `sanitizeHtml`'s
lowercase set is derived from it, so the two can no longer drift.

### Vendored build sizes

Generated from v0.13.3 with the pinned `@jfs/vendor-cli` (0.21.6), unminified.
A narrowed build is esbuild's reprint of the reachable body, so its comments
are dropped (only the provenance header and `index.js`'s file-top preamble are
re-attached); a full surface is never shaken and is the verbatim source. Every row
naming a consumer is byte-for-byte the size of that consumer's committed copy
(measured 2026-09-22). `--format global` — the three rows that name no
consumer use `--name NewsKit`; a global build spells its name twice, so each
character of it is two bytes:

| Pick | Bytes |
|---|---|
| `escapeHtml` | 1,729 |
| `createModal` | 12,220 |
| JFS-Sports' four globals (`NewsKitSanitize`, `NewsKitDedupe`, `NewsKitRiver`, `NewsKitSourceMenu`) | 32,554 |
| Surf-Tracker's three globals (`NewsKitSanitize`, `NewsKitRiver`, `ModalKit`) | 33,013 |
| BearsMockDraft's four globals (`NewsKitSanitize`, `NewsKitRiver`, `NewsKitSourceMenu`, `ModalKit`) | 43,796 |
| full 48-export surface (unshaken) | 119,759 |

`--format esm`:

| Pick | Bytes |
|---|---|
| `escapeHtml` | 1,741 |
| `escapeHtml`, `safeUrl`, `safeImageUrl`, `sanitizeHtml` (Art-Gallery-) | 5,216 |
| market-monitor's 9 exports | 41,988 |
| John's News' 9 exports | 49,998 |
| full 48-export surface (unshaken; JFS-Sports) | 118,486 |

A narrowed build carries no sanitizer-policy marker regions: since vendor-cli
0.20.0 it reprints policy code like any other code and strips the marker
lines. The policy values are gated at the SOURCE instead — this repo's
`npm run policy:check` in CI, and the generator itself, which validates this
kit's marked regions against the canonical family policy before it writes or
checks any consumer's copy.

A vendor-cli pin bump can change a narrowed build's bytes (0.13.0 and 0.16.0
both did), which a consumer picks up as `vendor:check` drift and a site version
bump; a full-surface copy is verbatim source and does not move on a CLI bump.

## Using it

Consumers pin the package by **commit SHA** and vendor it with the kit's own
CLI (`jfs-news-kit-vendor`), with the same invocation plus `--check` in CI
failing the build on drift. An ESM consumer copies the module verbatim
(`--format esm --out js/vendor/news-kit/index.js`); a classic-script consumer
takes an IIFE global, optionally narrowed to just what it uses, e.g. a
reader-only sanitizer
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

`--pick` narrows `--format esm` too, so a buildless consumer that imports the
vendored copy as a browser ES module ships only what it uses.

### No `overrides` workaround needed

`jfs-news-kit-vendor` is a shim over whatever `@jfs/vendor-cli` resolves
**from inside this package**, so the CLI you get is fixed by this kit's own
`dependencies` pin. While that pin was 0.11.0 — which rejected `--pick`
outside `--format global`/`cjs` — ESM consumers had to force the resolution
from the outside:

```json
"overrides": { "@jfs/news-kit": { "@jfs/vendor-cli": "github:…" } }
```

The pin has tracked vendor-cli's HEAD since 0.12.0 (the weekly bumper moves
it), so **that entry can be deleted once you re-pin `@jfs/news-kit` to any
0.12.0-or-later commit** — and every consumer in the family already has. No override is needed even
if your own tree carries an older `@jfs/vendor-cli` at top level: npm nests
the correct copy under `@jfs/news-kit` and the shim resolves the nested one.

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

CI (`.github/workflows/test.yml`) runs four commands, in this order, and so
does the weekly kit-pin bump before it merges anything:

```
node --check index.js
npm run lint
npm run policy:check
npm test
```

jsdom 30 needs Node `^22.22.2 || ^24.15.0 || >=26.0.0` to run the DOM tests.
That is a floor for working ON this kit, not for using it: `index.js` imports
nothing, and `engines.node` stays `>=18` because it describes the shipped
module.

`index.js` itself imports nothing; jsdom is installed on `globalThis` inside
the DOM-dependent test files (`test/*-dom.test.js`, `test/dom.test.js`) or
constructed per-test (`test/modal.test.js`) before the kit is imported, so the
browser code paths (DOMParser feed parsing, both sanitizers, the river and
source-menu renderers, the focus trap / scroll-lock / Escape stack) are
exercised in CI. `test/side-effects.test.js` deliberately runs with NO DOM
globals — it is what proves `"sideEffects": false`.

## Versioning

Bump `version` in `package.json` for every change to `index.js` or `bin/` —
family CI's version guard fails a pull request that changes either without
one. Don't tag by hand: `.github/workflows/release.yml` tags `vX.Y.Z` and
opens the GitHub release once `Test` is green on `main`. The `index.js` banner
deliberately carries no version — vendored copies get `v${pkg.version}`
stamped by the shared vendor CLI. Consumers pin SHAs, so nothing moves until
they re-pin and run `npm run vendor:sync`.
