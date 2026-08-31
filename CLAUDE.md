# @jfs/news-kit — working notes for Claude

Shared, dependency-free news **and DOM** primitives (RSS parsing, dedupe,
classification, HTML escaping, URL guards, two whitelist HTML sanitizers, an
auto-escaping `el()` element builder, relative time, news-river rendering,
the Sources filter, and accessible modal plumbing) extracted from the JFS
family of apps. Consumers vendor this kit via its own CLI rather than
installing it at runtime, so a change here reaches an app only once that app
bumps its pin and re-runs `vendor:sync`.

## This kit ABSORBED @jfs/dom-kit and @jfs/modal-kit (v0.12.0)

Both were retired into this repo. Per the family's own extraction bar —
*prefer growing an existing kit over minting a new one* — three kits'
permanent CI / pin / vendoring overhead was not buying anything: dom-kit's
13 exports overlapped this kit's escaper and URL guards, and modal-kit was
554 lines behind effectively ONE public export.

**That migration is complete.** Every consumer takes those exports off this
kit, and `jsvolos63/dom-kit` / `jsvolos63/modal-kit` are ARCHIVED on GitHub —
read-only history, no pins, no CI. The family is five kits now (news, pwa,
netlify, fetch, vendor-cli — cache-kit has since been absorbed into
fetch-kit v0.2.0 and retired the same way). Never re-add either pin.

What the merge did:

- **One escaper.** `dom-kit#escapeHtml` and `news-kit#escHtml` were verified
  byte-identical over 85,683 differential inputs (every UTF-16 code unit,
  astral characters, lone surrogates, `null`/`undefined`/non-strings, 20k
  fuzzed strings). They are now ONE function exported under all three names
  — `escapeHtml`, `escHtml`, `escAttr` — so no consumer's import changes.
  `test/escape-dedup.test.js` keeps the proof executable.
- **Four URL guards, none collapsed** (v0.13.0 — it was six). `safeUrl`,
  `safeImageUrl`, `safeContentUrl` and `isSafeContentUrl` differ pairwise on
  real inputs (reject sentinel `#` / `''` / `null` / `false`, relative-URL
  policy, `new URL()` normalization, `data:image` and `blob:` allowances).
  Unifying any pair would be a security change, not a refactor; the
  divergences are documented in the `dom` section of `index.js` and pinned
  by tests. The two that WERE retired — `sanitizeUrl` / `sanitizeHref` —
  went back to JFS-Sports, their only consumer ever (no internal caller):
  preserved per-repo idiom, not contracts this kit needed. `safeContentUrl`
  looked single-consumer too, but the river renderer itself calls it — check
  internal callers, not just consumer imports, before retiring an export.
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
what the three ESM consumers need — see below. Two historical constraints on
editing `index.js` have LAPSED and should not be re-imposed:

- The old hand-written shaker rooted a declaration by identifier occurrence
  anywhere in a kept chunk, which is why this file avoids `el` as a local
  binding name. Since vendor-cli 0.16.0 the reachability analysis is
  esbuild's real binding analysis, so a local `el` no longer drags the
  exported builder in — the naming discipline survives only as style.
- Sanitizer-policy marker regions used to be permanent tree-shake roots,
  preserved byte-exact in narrowed builds by a graft pass. vendor-cli 0.20.0
  retired that: a narrowed build treats policy code like any other code
  (unreachable regions drop; reachable ones are reprinted with their values,
  markers stripped). The canonical values are guarded at the SOURCE — this
  repo's own `policy:check` in CI — and full-surface copies stay verbatim
  and generation-gated, so nothing changes about how you edit the regions
  here: only through `jfs-sanitizer-policy-sync`.

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

The pin has long since moved past 0.12.0 (it tracks vendor-cli HEAD via
the weekly bumper — don't restate the SHA here, it goes stale), so **that
`overrides` entry is dead
weight once a consumer re-pins news-kit to this commit or later** — and
every consumer has dropped it; don't let one back in. Verified from a
consumer's perspective: with
no override at all, a throwaway install of this package resolves a
`--pick`-in-esm-capable vendor-cli and `--format esm --pick …` succeeds; it
also succeeds when the consumer carries an *older* vendor-cli at top level,
because npm nests this one under news-kit and the shim resolves the nested
copy. `test/vendor.test.js` pins the narrowed-esm behavior so a pin
regression fails CI here rather than in three consumers' `vendor:sync`.

Because that pin decides what every consumer vendors, it gets the same
weekly bumper the consumer repos run: `.github/workflows/kit-pin-bump.yml`
(the family reusable workflow, `kit-pins:bump` → `jfs-bump-kit-pins`, which
scans `dependencies` as well as `devDependencies`). There was no such
workflow at first, which is how the pin sat at 0.13.0 while vendor-cli
shipped 0.14.0 — the only @jfs pin in the family nothing watched. `verify-kit-pins: true` in
`test.yml` pre-flights that it still resolves. No `vendor:sync` and no
version bump run in that workflow: this kit's semver tracks `index.js` +
`bin`, which a CLI pin bump doesn't touch.

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

## Lint

`npm run lint` (ESLint flat config, `eslint.config.mjs`); CI runs it. This kit
was the family's widest-blast-radius code with **no linter at all** — a bug
here reaches every consumer's vendored copy on their next pin bump, and that
copy lands as bundler output nobody reads line by line.

Adopting it surfaced eight findings; four were real and are fixed, and two
RULES are off because they fire on this kit's whole reason for existing:

- **`no-control-regex` is off.** Stripping C0/C1 control characters out of
  URLs is exactly what the guards here do, so the rule flags the security code
  rather than a mistake — and one of its two hits is inside the generated
  `@jfs-sanitizer-policy:url-control-chars` region, which may only ever change
  through `jfs-sanitizer-policy-sync`. Turning the rule on would invite
  someone to hand-edit a canonical region to silence a linter.
- **`no-regex-spaces` is off.** `test/vendor.test.js` matches a known
  two-space indent in generated output; the literal reads better than `{2}`.

The four real fixes: a `cap` shadow in `mergeItems` (a module-level string
truncator hidden by a local count — renamed to `limit`), a literal U+00A0
NO-BREAK SPACE inside a character class in the headline splitter (now written
as `\u00A0`, behaviour-identical but no longer invisible), and two unused
bindings in the suite.

Keep the disabled list this short. A third entry should feel like a decision,
not a convenience — the point of the linter here is that nothing else reads
this file closely.

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

### Session autonomy

These repos are worked by automated Claude Code sessions with the owner
away, so a session that stops to ask has usually failed at the task. Every
repo's `.claude/settings.json` carries the family allowlist and
`acceptEdits`, so the ordinary tools of the job — reads, edits, git, the
npm scripts, the GitHub API — run without a permission prompt. Use them.

Ask a follow-up question only when proceeding either way would be wrong: a
genuine product decision, or an ambiguity whose two readings produce
materially different work. Routine calls — naming, file placement, patch
vs. minor, which helper to extract — belong to the session: pick the
obvious one, say so in the PR body, and keep going.

Merging is the session's job too. Open the PR ready for review, dispatch
CI, and squash-merge it once that run is green on the head commit. A
finished, green PR left open for a human to click is the outcome this
section exists to prevent. The gate itself does not move: green CI on the
head commit is still the precondition for every merge, and a red run means
fix it and re-dispatch — never merge anyway, and never park it and ask.

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

### Look & feel baseline

These are mechanical UI rules, not a shared design system — each app keeps
its own look. They exist because each was violated in at least one family
repo and shipped as a real defect.

1. `env(safe-area-inset-*)` and `viewport-fit=cover` travel together — using
   one without the other is a bug (the insets resolve to 0 without it, and
   `black-translucent` status bars need it).
2. Every app has a global `:focus-visible` rule and sets
   `-webkit-tap-highlight-color` deliberately.
3. The `theme-color` meta, the manifest `theme_color`, the manifest
   `background_color`, and the app's `--bg` all agree (with a dark variant
   where the app has a light mode).
4. The version badge lives in the header and is rendered from build config,
   never hand-typed in HTML.
5. Webfonts are either self-hosted (subset, preloaded, `font-display: swap`)
   or absent — a font-family the page doesn't load must not be named first
   in a stack.

<!-- jfs-family-conventions:end -->
