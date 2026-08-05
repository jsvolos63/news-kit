# @jfs/news-kit — working notes for Claude

Shared, dependency-free news **and DOM** primitives (RSS parsing, dedupe,
classification, HTML escaping, URL guards, two whitelist HTML sanitizers, an
auto-escaping `el()` element builder, relative time, news-river rendering,
the Sources filter, and accessible modal plumbing) extracted from the JFS
family of apps. Consumers vendor this kit via its own CLI rather than
installing it at runtime, so a change here reaches an app only once that app
bumps its pin and re-runs `vendor:sync`.

## This kit ABSORBED @jfs/dom-kit and @jfs/modal-kit (v0.12.0)

Both are being retired into this repo. Per the family's own extraction bar —
*prefer growing an existing kit over minting a new one* — three kits'
permanent CI / pin / vendoring overhead was not buying anything: dom-kit's
13 exports overlapped this kit's escaper and URL guards, and modal-kit was
554 lines behind effectively ONE public export. The source repos stay in
place until every consumer has migrated its imports; nothing in them should
be edited in the meantime.

What the merge did:

- **One escaper.** `dom-kit#escapeHtml` and `news-kit#escHtml` were verified
  byte-identical over 85,683 differential inputs (every UTF-16 code unit,
  astral characters, lone surrogates, `null`/`undefined`/non-strings, 20k
  fuzzed strings). They are now ONE function exported under all three names
  — `escapeHtml`, `escHtml`, `escAttr` — so no consumer's import changes.
  `test/escape-dedup.test.js` keeps the proof executable.
- **Six URL guards, none collapsed.** `safeUrl`, `safeImageUrl`,
  `sanitizeUrl`, `sanitizeHref`, `safeContentUrl` and `isSafeContentUrl`
  differ pairwise on real inputs (reject sentinel `#` / `''` / `null` /
  `false`, relative-URL policy, `new URL()` normalization, HTML-escaping of
  `&`, `data:image` and `blob:` allowances). Unifying any pair would be a
  security change, not a refactor; the divergences are documented in the
  `dom` section of `index.js` and pinned by tests. **Do not "simplify" them
  into one.**
- **Two sanitizers, both kept.** `sanitizeHtml` returns a STRING with the
  smaller dom-kit allowlist; `sanitizeHtmlToFragment` returns a
  `DocumentFragment` with the article-reader allowlist and an injectable URL
  policy. Different contracts, different callers.
- **ONE copy of each sanitizer-policy region.** dom-kit used to carry its own
  `blocked-tags` and `url-control-chars` marked regions, hand-synced across
  repos by `jfs-sanitizer-policy-sync` (they drifted once — MATH). The kit
  now has exactly one region of each: `DEFAULT_BLOCKED` (uppercase) is the
  policy-owned list, and the dom sanitizer's lowercase `_BLOCKED_TAGS` is
  DERIVED from it. `npm run policy:check` reports "2 regions"; if it ever
  reports more, someone re-introduced a mirror.
- **Modal listeners stay lazy.** The Escape / popstate / pagehide handlers
  are wired on the first `open()`, never at module scope, so
  `"sideEffects": false` stays honest and the vendoring CLI can tree-shake a
  narrowed build. `test/side-effects.test.js` pins this.

## Tree-shaking is why the merged kit is not a size regression

Since `@jfs/vendor-cli` 0.11.0 a `--pick`/`--global`-narrowed build is
tree-shaken to the reachable body, so a consumer that only wants the escaper
ships ~5 KB, not the 113 KB full bundle. 0.12.0 extends that to `--format
esm` (0.11.0 rejected `--pick` outside `global`/`cjs` entirely), which is
what the three ESM consumers need — see below. Two consequences to keep in
mind when editing `index.js`:

- The tree-shaker roots a top-level declaration by **identifier occurrence
  anywhere in a kept chunk**, including local variables and object keys.
  That is why nothing in this file uses `el` as a local binding — a local
  `el` would drag the exported `el()` builder into every narrowed build.
  (The modal section's `{ el: dialogEl }` callback payload is the one place
  the name is unavoidable; it costs modal-only builds ~2.4 KB.)
- Any declaration whose text contains the sanitizer-policy marker prefix is
  a permanent root, so never spell that prefix in ordinary prose comments.

## Consumers no longer need the `overrides` workaround

`bin/vendor.mjs` is a shim: it runs whatever `@jfs/vendor-cli` resolves from
**inside this package**, so the CLI a consumer gets is decided by THIS
repo's `dependencies` pin — not by anything in the consumer's tree. (The pin
belongs in `dependencies`, not `devDependencies`: a consumer installing
news-kit gets its dependencies but not its devDependencies, so the shim
would have nothing to load.)

While that pin was `386e8eb` (0.11.0), which rejects `--pick` outside
`--format global`/`cjs`, the three ESM consumers — Art-Gallery-,
market-monitor, John's News — could only get a narrowed ESM copy by forcing
the resolution from outside:

```json
"overrides": { "@jfs/news-kit": { "@jfs/vendor-cli": "github:…#<0.12.0 sha>" } }
```

The pin is now `e64511e` (0.13.0), so **that `overrides` entry is dead
weight once a consumer re-pins news-kit to this commit or later** — drop it
in the same PR as the pin bump. Verified from a consumer's perspective: with
no override at all, a throwaway install of this package resolves a
`--pick`-in-esm-capable vendor-cli and `--format esm --pick …` succeeds; it
also succeeds when the consumer carries an *older* vendor-cli at top level,
because npm nests this one under news-kit and the shim resolves the nested
copy. `test/vendor.test.js` pins the narrowed-esm behavior so a pin
regression fails CI here rather than in three consumers' `vendor:sync`.

### 0.13.0 shrinks every narrowed build by exactly 131 B

The pin moved `eba0518` (0.12.0) → `e64511e` (0.13.0), six lexer/mask fixes
in the tree-shaking generator plus a post-shake gate that refuses generation
if a dropped top-level name still lives in the emitted body. Only one of the
six moves bytes here: the `$` of a `${…}` interpolation is now its own
punctuation class, so a template literal anywhere in a kept chunk no longer
roots this file's top-level `export const $` selector shorthand. Every
narrowed build whose reachable set contains a template literal loses that
one dead declaration — `-131 B`, verified identical across the esm, global,
cjs and bare formats and across the real Art-Gallery- / market-monitor /
John's News pick lists. A pick list with no reachable template literal
(Weather's `byId,elem`) is unchanged, and the **full, unnarrowed surface is
byte-identical in all four formats** — a full surface is never shaken.

Consumers therefore see a byte change on their next `vendor:sync`, so a
re-vendor needs the usual site version bump; nothing they import changes
behavior.

<!-- jfs-family-conventions:start — managed by jfs-claude-md-sync; edit family/family-conventions.md in @jfs/vendor-cli -->

## Family conventions

These conventions are identical across every repo in the @jfs family. The
section is managed by `jfs-claude-md-sync` (@jfs/vendor-cli) and checked by
family CI — edit `family/family-conventions.md` in the vendor-cli repo, not
here.

### Pull requests

Open pull requests **ready for review — never as drafts.** This applies to
PRs opened by automated Claude Code sessions too: some hosted environments
default to creating drafts, so mark the PR ready as part of opening it
rather than leaving it for a follow-up.

### Kit extraction bar

Extract shared code into a NEW `@jfs/*` kit only when both hold: a third
repo needs the same code, AND drift between the existing copies has already
caused a real bug or a manual reconciliation. Until then, copy-pasting
between two repos is cheaper than a new repo's permanent CI, pin, and
vendoring overhead. Prefer growing an existing kit over minting a new one.

### CI on automated pull requests

A push from an automated session does not fire `pull_request` workflows, so
a session-opened PR starts with no CI run of its own. Every repo's CI
workflow carries `workflow_dispatch:` so the session can run the same checks
by hand: dispatch CI on the branch, and do not merge until that run is green
on the head commit. A merge with no CI run defeats every gate the family
maintains.

<!-- jfs-family-conventions:end -->
