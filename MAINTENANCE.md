# Maintaining @jfs/news-kit

This kit's own housekeeping is in good order and can be shown to be: the one
`@jfs` pin moves every Monday (the last six scheduled bumps succeeded),
`v0.13.3` is tagged, and `npm test` is 205 green. None of that is delivery.
Forty-eight exports reach six other repositories as **committed bundler
output**, and a fix here changes nothing in any app until that app re-pins
this kit and re-runs its own vendoring — so the first thing to check is the
delivery table below, not this repo's CI. As of 2026-09-22 all six carry the
v0.13.3 surface; that morning one of them was still a version behind on a
security patch. The other two things maintenance here turns on are that this
repo holds the family's canonical sanitizer-policy **source** gate, and that
its CI can go red with no commit in it.

## What runs by itself

| Automation | Fires | Lands by itself | Leaves for a session | How a failure would be noticed |
| --- | --- | --- | --- | --- |
| `.github/workflows/test.yml` → `family-ci.yml@main` (`verify-kit-pins: true`, `maintenance-check: true`, `install-command: npm install`, `prod-audit: true`, `version-guard-paths: index.js bin`) | push to `main`, every `pull_request`, `workflow_dispatch` | — it *is* the gate | nothing | red on the PR or the commit — the one automation here that fails where somebody is already looking |
| `.github/dependabot.yml` + `.github/workflows/dependabot-merge.yml` (`workflow_run` on `Test` completed) | npm weekly Tuesday, minor+patch grouped; `github-actions` monthly | every minor/patch bump, squash-merged on green | **every major**, and any PR body it cannot parse | a PR sits open. Nobody is told. #51 (jsdom 30.0.1) sat 13 days; the 2026-09-22 sweep superseded it. |
| `.github/workflows/kit-pin-bump.yml` (`cron: '41 6 * * 1'`, Mondays ~06:41 UTC) + dispatch, → `kit-pin-bump.yml@main` with `install-command: npm install`, `vendor-sync-command: ''`, `version-bump-command: ''` | weekly | the `@jfs/vendor-cli` pin, the CLAUDE.md conventions block, the PR, the squash-merge | nothing, when it works | **nothing.** A scheduled run fails on its own page and notifies no one. It has already failed twice here. |
| `.github/workflows/release.yml` (`workflow_run` on `Test` completed, `branches: [main]`) + dispatch | `Test` green on `main` | the `v<version>` tag and its GitHub release | nothing | **nothing.** A missing tag is visible only by comparing the tag list against `package.json`. |

This repo's CI workflow is `test.yml`, not the `ci.yml` the apps use — as in
the three sibling kits, Art-Gallery- and vendor-cli, all of which also name it
`Test`, which is why `release.yml` and `dependabot-merge.yml` here both say
`workflows: [Test]`. That string must match the CI workflow's `name:` exactly
or the trigger silently never fires, and it is genuinely inconsistent across
the family: JFS-Sports' file is `test.yml` too but its workflow is named
`Tests`. There is no deploy, no hosting, no cron beyond the Monday bump, and
no `smoke.yml`-style prober anywhere in this repo; only market-monitor opens an
issue when its own automation fails.

**This repo's kit-pin bump is not one of the broken ones.** Its schedule is
`41 6 * * 1` and verified 2026-09-22 against the Actions API: eight runs, and
the last six *scheduled* ones — 2026-08-17 through 2026-09-21 — all succeeded.
Run #7 (2026-09-14) opened and merged PR #54 as `github-actions[bot]`, so this
repo's *Settings →
Actions → General → Workflow permissions* does grant Actions the right to
create pull requests: the per-repo setting whose absence has silently broken
the identical workflow in pwa-kit, fetch-kit and Netlify-kit for four to five
weeks. Run #8 (2026-09-21, 17 seconds) was a correct no-op — vendor-cli's HEAD
at 06:41 UTC that morning was still the pinned `bf9b859`, and the two commits
since landed later. `git ls-remote --heads origin 'refs/heads/auto/*'` returns
nothing here.

Two of the eight runs did fail — the very first scheduled run (2026-08-10) and
a manual dispatch (2026-08-17) — and **nothing reported either**. They are the
local proof of the family block's "Who watches the watchers": the workflow that
protects this kit's whole consumer chain broke on its debut and sat broken for a
week.

**`dependabot-merge.yml` has never merged anything here, correctly.** All ten
of its runs (to 2026-09-22) concluded `skipped`, and the reason is the reusable
job's own `if:` — it runs only when the triggering `Test` run was a
`pull_request` run, by `dependabot[bot]`, that **succeeded**. Nine of the ten
were triggered by pushes and dispatches, so they skip by design. The tenth,
run #2, was triggered by Dependabot's own `Test` run on #51 — which proves the
`workflows: [Test]` name match fires — and skipped because that run was red
(the stale CLAUDE.md block, not jsdom). Had it been green, the job would have
run and left #51 open anyway, because a major is not merged. So the *merge*
path is still unexecuted here, and the first grouped minor/patch PR will be its
first real test; the name match it depends on is now gated by
`test/repo.test.js`.

**A bot-merged bump never gets a CI run of its own on `main`.** `5468b98`, the
2026-09-14 kit-pin bump, has no `Test` run: a push made with the default
`GITHUB_TOKEN` creates no workflow runs, so neither `Test` nor `Release` fired
on it, and the bump workflow's in-workflow `check-command` is the only
evidence it was green. That is why `check-command` must be the whole gate —
it now is, and `test/repo.test.js` holds it to `test.yml`'s list. The next
human-merged commit gets a run (`39ffd45` has `Test` #122, green), so the gap
lasts until then. No tag was missed, because a kit-pin bump does not move the
version, but the weekly check still compares the newest tag against
`package.json` rather than trusting `Release`. Sort the tags by version — a
plain `tail -1` sorts them as text and returns `v0.9.2`:

```
git ls-remote --tags --sort=v:refname origin | tail -1
node -p "require('./package.json').version"
```

**CI here goes red without a commit here.** `family-ci.yml` checks the
CLAUDE.md family-conventions block against vendor-cli's **main**, not against
this repo's pin, so an edit to the canonical text reddens this repo
immediately. It has happened: `Test` run #111 on `main` failed on 2026-09-09
after vendor-cli 0.21.4 added two sections, and was green again 27 minutes
later once #52 re-synced the block. As of this commit `maintenance-check: true`
puts **this file's** canonical block under exactly the same rule, so there are
now two synced blocks that a vendor-cli docs commit can turn red. Neither is a
bug to work around: re-sync and push.

## The gate

**There is no aggregate `check` script in this repo.** CI runs four commands
in order, fail-fast, and a session before pushing runs the same four:

```
node --check index.js
npm run lint
npm run policy:check
npm test
```

| Step | What it is |
| --- | --- |
| `node --check index.js` | parses the one shipped file. Parsing is not analysis. |
| `npm run lint` | `eslint .` — `index.js` gets browser **and** Node globals (it runs in both), `bin/**` and `test/**` get Node plus browser for the DOM fixtures |
| `npm run policy:check` | `jfs-sanitizer-policy-sync --check index.js`. Prints `2 regions`. **If it ever prints a different count, someone re-introduced a policy mirror.** |
| `npm test` | `node --test` — Node's own discovery over the 17 files in `test/`, 205 cases |

All four are offline, and `kit-pin-bump.yml` passes the same four as its
`check-command`. It used to omit `npm run lint`, on the theory that a
vendor-cli pin bump cannot change `index.js`. But there is no lockfile, so the
bump's `npm install` resolves eslint's floating range fresh, and a new eslint
minor could redden lint while the bump merged green onto a `main` that then
has no CI run. `test/repo.test.js` now fails when the two lists differ.
What else a bump could break that `check-command` cannot see is the
family-ci-only half below; the conventions block is re-synced by the bump
itself.

Checks that run only in CI, with no local spelling:

- the `@jfs` pin pre-flight (`verify-kit-pins: true`), which proves the
  vendor-cli SHA still resolves before `npm install` fails opaquely on it;
- the CLAUDE.md conventions check and, as of this commit, the MAINTENANCE.md
  pair — the canonical-block sync check and the claim check that reads this
  half against the repo;
- the shipped-dependency audit (`prod-audit: true`, i.e.
  `npm audit --omit=dev --audit-level=high` after the install);
- the version-bump guard, on pull requests only, over `version-guard-paths:
  index.js bin`.

This repo has **no** `vendor:sync` / `vendor:check` scripts — it vendors
nothing; it *is* the thing vendored — so family-ci's vendor-script-parity step
prints `scripts absent - skipped`. It passes `prod-audit: true` (since
2026-09-22), like the other three kits: the one production dependency,
`@jfs/vendor-cli`, pulls `esbuild` in behind it and is real production surface
*for every consumer that installs this package*. There is no committed
lockfile, so the audit reads the one `npm install` writes into the workspace.
It reported 0 vulnerabilities on 2026-09-22.

## What "delivered" means for a kit

The family block's "Green CI is not delivered" applies here with a different
shape: there is no deploy to confirm. Delivery is **six other repositories'
committed vendored copies**, and each one moves only when that repo bumps its
`@jfs/news-kit` pin and re-runs its own vendoring. Measured 2026-09-22 (evening),
against each repo's `origin/main`:

| Consumer | Pins | Format / picks | Vendored header |
| --- | --- | --- | --- |
| John's News | `5468b98` | esm, 9 picks | v0.13.3 |
| Art-Gallery- | `5468b98` | esm, 4 picks | v0.13.3 |
| market-monitor | `5468b98` | esm, 9 picks | v0.13.3 |
| BearsMockDraft | `5468b98` | global, 4 named globals | v0.13.3 |
| Surf-Tracker | `5468b98` | global, 3 named globals | v0.13.3 |
| JFS-Sports | `39ffd45` | full esm **plus** global, 4 named globals | v0.13.3 (both files) |

`5468b98` and `39ffd45` carry the same `index.js` and `bin/` — the commits
between them are docs and CI — so all six ship the same surface. Every
committed copy is also byte-for-byte the size a fresh generation through
`bin/vendor.mjs` produces with the same picks, which is how the README's size
table was re-measured.

Weather and FlightCheck deliberately carry no pin at all — each retired it
rather than keep a permanent pin, a drift-gate stage and a weekly bump PR for
two helpers (Weather's `byId` / `elem`, FlightCheck's `byId` / `escapeHtml`),
both now app-owned. Do not read their absence as drift.

JFS-Sports was the gap until the evening of 2026-09-22. It pinned `1d8e9fc`
(v0.13.2) and so shipped an `el()` that handed `href` / `src` / `srcdoc` to
`setAttribute` verbatim, and a `safeUrl` / `safeImageUrl` pair that returned
`https://nytimes.com@evil.com/x` intact — the v0.13.3 hardening was not in
effect there for eleven days after it was tagged. Its kit-pin bump had failed
four Mondays running on the `fetch-data.mjs` credential gap. Once vendor-cli
fixed that, a dispatched bump (run 35789266167) merged JFS-Sports #720 and
moved the pin to `39ffd45`. The lesson is the one in "What nothing watches":
nothing in the family notices a consumer that stops re-pinning.

The quickest read of the whole picture, with the family checked out side by
side:

```
grep -h '"@jfs/news-kit"' ../*/package.json | sort | uniq -c
```

A second delivery fact worth knowing before touching anything: the vendored
copies' provenance header carries `v${pkg.version}`. So **any** version bump
here changes every consumer's vendored bytes, failing their drift gate until
they re-sync, which in turn obliges a site version bump in the browser-shipping
ones. That is why this repo bumps for a change to `index.js` or `bin` and never
for a docs-only change, and why the version guard watches exactly those two
paths.

## Cross-file invariants

| Invariant | Halves | Gated by |
| --- | --- | --- |
| The blocked-tag list and the URL control-char regex are the canonical family policy | the two `@jfs-sanitizer-policy:` regions in `index.js` ↔ `sanitizer-policy.json` in @jfs/vendor-cli | `npm run policy:check` in both `test.yml` and `kit-pin-bump.yml`, **and** inside the vendoring generator since vendor-cli 0.17.0 — so every consumer's drift gate re-verifies this source on every run of theirs |
| The lowercase `_BLOCKED_TAGS` is **derived**, not mirrored | one `const` in `index.js` reading `DEFAULT_BLOCKED` | the code itself. There is no second region and there must never be again: the mirror drifted once, on MATH |
| `"sideEffects": false` is true — no listener, no DOM touch, no global at module scope | `package.json` ↔ `index.js` | `test/side-effects.test.js` (imports with no DOM present, and counts `addEventListener` calls) |
| `escapeHtml` / `escHtml` / `escAttr` are one function object | three names, one declaration | `test/escape-dedup.test.js` |
| The four URL guards diverge exactly as documented | `index.js` ↔ the README's worked-examples table | `test/escape-dedup.test.js` pins each divergence and, since 2026-09-22, every cell of that table (it used to pin each row's divergence but not every cell) |
| The generator this kit's shim hands consumers still behaves | `dependencies.@jfs/vendor-cli` ↔ what six repos vendor | `test/vendor.test.js`, which drives the pinned CLI's generator — so a vendor-cli bump that would change what consumers vendor fails **here**, rather than in six consumers' vendoring |
| A shipped change carries a version bump | `index.js`, `bin/` ↔ `package.json` version | family-ci's version-bump guard, pull requests only |
| **Six consumers' `--pick` lists name exports that exist** | `index.js` ↔ six other repos' package.json | **prose only.** All 25 distinct picked names resolve (re-checked 2026-09-22 against each consumer's `origin/main`). A removed or renamed export refuses loudly at the *consumer's* drift gate — but only on their next re-vendor |
| `engines.node: ">=18"` | `package.json` ↔ nothing | **prose only, and unexercised.** The kits pass no `node-version-file` and have no `.nvmrc`, so CI rides family-ci's default Node 22. Nothing here has run on 18 in a long time. The *dev* floor is higher and separate: jsdom 30 needs `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` to run the DOM tests |
| `release.yml` and `dependabot-merge.yml` follow the CI workflow by its exact `name:` | their `workflows: [Test]` ↔ `test.yml`'s `name: Test` | `test/repo.test.js`. A mismatch is silent in Actions: a `workflow_run` naming a workflow that does not exist never fires |
| The Monday bump runs the whole gate | `kit-pin-bump.yml`'s `check-command` ↔ `test.yml`'s `run` | `test/repo.test.js` (the two lists must be identical; it failed on the old file, which lacked `npm run lint`) |
| The shipped files reach only what a consumer installs | `bin/vendor.mjs`'s imports ↔ `dependencies` (never `devDependencies`); `index.js` ↔ no imports at all; `files` ships both | `test/repo.test.js` |
| The rest of the README describes the current kit | `README.md` ↔ `index.js`, and ↔ the generator | **prose only.** Re-read on 2026-09-22 and corrected (see the run log) |

The prose-only rows are the monthly sweep's work. The mechanizable one is the
consumer-pick invariant: a test in this repo that reads the sibling repos'
package.json `vendor:sync` strings and asserts every `--pick` name is in the
derived surface would turn "weeks later, in someone else's CI" into "now, here"
— at the cost of depending on a side-by-side checkout, which is why it is not
written yet.

## What nothing watches

Nothing here talks to an upstream feed, a scraped page or a paid API — the kit
is dependency-free by design and its suite is offline. What rots instead:

- **The six consumers' pins.** Nothing in this repo notices that a consumer is
  a version behind on a security patch. That is how JFS-Sports' eleven-day gap
  became a fact nobody had written down. vendor-cli's
  `tools/family-liveness.mjs` asks the pin question family-wide every Monday,
  but only once the owner configures its `FAMILY_READ_TOKEN` (Vendor-cli #60);
  until then it exits 2. Silent.
- **The canonical sanitizer policy in vendor-cli.** An edit there reddens
  `npm run policy:check` here on the next CI run with no commit in this repo.
  Loud, but it fails in the middle of unrelated work.
- **Floating devDependency ranges.** `package-lock.json` is gitignored, so
  every CI run resolves `eslint ^10.9.1`, `@eslint/js ^10.0.1`, `globals
  ^17.11.0` and `jsdom ^30.1.1` fresh. A new eslint minor that adds a rule to
  `js.configs.recommended` can redden this repo with no change here and no
  Dependabot PR to point at. Loud, and confusing the first time.
- **`bin/vendor.mjs`'s resolution promise.** It runs whatever vendor-cli
  resolves *from inside this package*, which is why the pin is in
  `dependencies` and not `devDependencies` — a consumer installs the former and
  not the latter. If that ever moved, every consumer would silently start
  vendoring through whatever CLI sat at the top of *their* tree.
  `test/repo.test.js` gates the placement now (2026-09-22).
- **Runner and action deprecation.** `peter-evans/create-pull-request` is
  SHA-pinned inside the shared `kit-pin-bump.yml` and still targets Node 20,
  which GitHub warns about on every run that reaches it. The warning is in a log
  nobody reads; the eventual removal will simply break the bump. The fix is
  vendor-cli's, not this repo's: Vendor-cli #49 (8.1.1) is open.
- **Whether the last bump run succeeded at all.** The whole of the weekly
  check. Nothing pushes, mails or comments.

## Cost and quota exposure

Essentially none, and worth stating so a session does not look for it: no
deploy, no hosting, no API key, no rate-limited upstream, no store, no billed
egress. The only spend is GitHub Actions minutes — four short workflows, one
weekly cron, runs measured in tens of seconds.

The real exposure this repo carries is not financial. It is **blast radius**:
one bad commit here becomes committed, unreviewed bundler output in six repos,
and the bad version is the one they pin. That is the whole justification for a
gate this heavy on a 118 KB single file, and for the linter existing at all.

## Generated and baked

| Never hand-edit | Regenerated by |
| --- | --- |
| the two `@jfs-sanitizer-policy:` regions in `index.js` | `npm run policy:sync`, against vendor-cli's canonical JSON. `npm run policy:check` gates it |
| the family-conventions block at the bottom of CLAUDE.md | `jfs-claude-md-sync` (@jfs/vendor-cli), checked against vendor-cli main by CI |
| the family-maintenance block at the bottom of **this** file | `jfs-maintenance-sync`, same rule |
| every vendored copy of this kit in the other six repos | that repo's own vendoring script, through `bin/vendor.mjs` |

There is no stamped constant here and no `version:stamp` — a kit has nothing to
propagate a version into. `index.js`'s banner deliberately carries no version;
the vendor CLI stamps `v${pkg.version}` into each generated copy's header at
generation time. Nothing in this repo is baked data.

## Deferred and stuck

No major is held. The one this file used to hold, jsdom 29 → 30 (#51, a
30.0.1 PR open since 2026-09-09), landed in the 2026-09-22 sweep as `^30.1.1`
rather than by merging #51, whose base was stale and whose floor admitted
30.0.0's known regressions. Dependabot closes #51 itself once `main` carries
the version. The dev-side Node floor it raises (`^22.22.2`) is recorded under
the invariants, and `engines.node` stays `>=18` on purpose: it is a promise
to consumers about the shipped module, which imports nothing.

| Dependency | Current → target | Verdict | Why | What would change the answer |
| --- | --- | --- | --- | --- |
| — | — | — | nothing held | the next major Dependabot opens |

Documented but unresolved:

- **`isAnyModalOpen` has no consumer importer.** Re-checked 2026-09-22: none of
  the six consumers' own source names it (only their vendored copies, which
  are the *definition*). Its removal was skipped in v0.13.3 because
  `test/modal.test.js` imports it and asserts on it in six places. Retiring it
  is an export removal, so a minor version bump that makes every consumer
  re-vendor; that is a decision, not maintenance. Before retiring it, check
  **internal** callers too: `safeContentUrl` looked single-consumer and the
  river renderer was calling it.
- **23 of the 48 exports are named by no consumer `--pick`.** They are not
  therefore dead — JFS-Sports vendors the full esm surface and lets esbuild
  shake it, and several are internal callers' targets — but the list is where a
  retirement candidate would come from. The bar this repo already set:
  `sanitizeUrl` / `sanitizeHref` went back to their single consumer in v0.13.0
  only once both "no internal caller" and "exactly one importer" held.
- **No committed lockfile.** The three sibling kits commit `package-lock.json`,
  so their devDependencies resolve the same way on every run; this repo and
  vendor-cli gitignore it, so every run resolves the floating ranges fresh (see
  "What nothing watches"). Adopting one means changing
  `install-command` in `test.yml` and `vendor-sync-command` in
  `kit-pin-bump.yml` together (so the lockfile follows the bumped pin). It is
  recorded rather than done because it reverses a standing choice here; the
  lint half of the risk is covered by the bump now running lint.
- **The consumer `--pick` invariant is still prose.** Mechanizing it needs the
  six sibling repos checked out beside this one, which CI does not have. It
  belongs in vendor-cli's family liveness monitor, which already reads every
  repo, rather than in a test here.

## What looks like cruft and is load-bearing

- **The two `/* @__PURE__ */` annotations** (`classify`, `FOCUSABLE_SELECTOR`).
  esbuild treats a top-level *call* as a potential side effect whatever
  `sideEffects: false` says, so without them both initializers root themselves
  into every narrowed build regardless of the pick list — and `classify`
  *executed* on page load in copies that pick none of the classifier. Measured
  on Art-Gallery-'s real four-export list: 7,688 → 6,255 bytes.
- **`vendor-sync-command: ''` and `version-bump-command: ''`** in
  `kit-pin-bump.yml`. Left at their defaults the run dies on
  `Missing script: "vendor:sync"`, which is what happened to pwa-kit,
  netlify-kit and fetch-kit on every scheduled run for two weeks before their
  callers were corrected (they fail today for a different reason — the
  create-PR repository setting). `install-command: npm install` is the third of
  the trio: there is no lockfile for `npm ci` to read.
- **`dependencies`, not `devDependencies`, for the vendor-cli pin.** See above:
  the shim resolves from inside this package, and a consumer gets dependencies
  only.
- **Four URL guards with four different reject sentinels**, and two sanitizers
  with different allowlists and return types. A differential run found every
  pair differing on real inputs. Unifying any two is a security change, not a
  refactor.
- **The modal's document/window listeners are wired lazily, on the first
  `open()`.** Module-scope registration would make `sideEffects: false` a lie
  and silently un-shake every narrowed build.
- **Two eslint rules are off with reasons inline** — `no-control-regex` (the
  URL guards' whole job is stripping control characters, and one hit is inside
  a canonical policy region that may only change through the sync tool) and
  `no-regex-spaces` (the vendor suite matches a known two-space indent in
  generated output). CLAUDE.md asks that a third entry feel like a decision.
- **`export const $` keeps its two-space alignment, and `el` is avoided as a
  local binding name.** Both date from the hand-written tree-shaker, which
  rooted declarations by identifier occurrence. esbuild's real binding analysis
  replaced it at vendor-cli 0.16.0 and the `$`-vs-template-literal case was
  fixed at 0.13.0, so these are now style, not constraints — noted here so
  nobody re-derives them as rules, and nobody "fixes" the `$` by renaming an
  export six repos may pick.

## Diagnosis

Ordered by how fast each resolves, not by likelihood.

1. **Is it red here, or red because vendor-cli moved?** Read the failing step's
   name first. `Check CLAUDE.md family conventions are in sync`, `Check
   MAINTENANCE.md ...` and `npm run policy:check` all compare against
   vendor-cli's **main**, so they fail with no commit in this repo. The fix is
   a re-sync or a `policy:sync`, not a code change.
   <https://github.com/jsvolos63/news-kit/actions>
2. **Reproduce the gate locally**, in CI's order — it is four offline commands
   and takes well under a minute after `npm install` (19 s on a loaded
   4-CPU container, 2026-09-22):
   `node --check index.js`, `npm run lint`, `npm run policy:check`, `npm test`.
3. **Did the weekly bump run and succeed?** Check the run, not the branch —
   and remember `main`'s HEAD legitimately has no `Test` run after a bump.
   <https://github.com/jsvolos63/news-kit/actions/workflows/kit-pin-bump.yml>
   Then `git ls-remote --heads origin 'refs/heads/auto/*'` — anything returned
   means the bump worked and could not deliver, which is a repository *setting*,
   not a code bug.
4. **"A consumer's vendoring broke after a pin bump."** Almost always one of
   three: an export it `--pick`s no longer exists (the generator refuses
   loudly — regenerate through `bin/vendor.mjs` with that repo's exact
   invocation to see it), the pinned vendor-cli changed the emitted bytes for a
   narrowed build (expected; the consumer re-syncs and bumps its site version),
   or `npm install` in the consumer resolved a different nested vendor-cli than
   this package's pin. The second case is the one `test/vendor.test.js` is
   meant to catch here before it reaches them, so check whether that suite
   still passes against the current pin before blaming the consumer.
5. **"The kit behaves differently in one app."** Check which copy that app
   holds before reading any code: `head -1` on its vendored file prints
   `VENDORED from @jfs/news-kit v<version>`. A full-surface copy and a narrowed
   one are the same source; a copy one version old is not.
6. **`npm run policy:check` prints a region count other than 2.** Somebody
   re-introduced a mirror of a policy constant. Find the second region before
   changing any value; do not hand-edit either.
7. **Only then read `index.js`.** It is 118 KB of one file and the suite is
   205 cases; a behavioral question is almost always faster to answer by adding
   a case than by reading.

## Run log

| Date | Cadence | Found / done |
| --- | --- | --- |
| 2026-09-22 | Weekly + monthly sweep | **Weekly, from the Actions API:** kit-pin bump's last scheduled run (#8, 2026-09-21) green; latest `Test` on `main` green (#122, `39ffd45`); `Dependabot merge` 10 of 10 `skipped` — by the reusable job's own `if:` (a green `pull_request` run by `dependabot[bot]`), not by a name mismatch; no `auto/*` branch; one leftover `claude/family-review-3urdej` (at `3d86024`, already in `main`, no PR) for the owner to delete; the vendor-cli pin `bf9b859` is three commits behind HEAD `3e9e174`, none touching the generator, for Monday's bump; one bot PR, #51, 13 days old and red on a stale base. **Baseline gate on `main` clean** (lint, `policy:check` 2 regions, 200/200, doc check, both sync checks, prod audit 0, pin pre-flight). **Landed:** jsdom `^30.1.1` on this branch, superseding #51 (Dependabot closes it once `main` carries the version); 205/205 on 30.1.1; `engines.node` stays `>=18`. **Fixed:** the Monday bump's `check-command` lacked `npm run lint` while its comment claimed parity with `test.yml`; `prod-audit: true` in `test.yml`; new `test/repo.test.js` gates three cross-file rules (workflow_run names, check-command parity, shipped-dependency placement), mutation-tested (ten breaking edits each fail it; a quoted `'Test'` correctly passes); `test/escape-dedup.test.js` now pins every cell of the README guard table. README: the policy-marker claim retired at vendor-cli 0.20.0, "50-export" (48), the stranded seven-column row, the size tables re-measured at v0.13.3 / vendor-cli 0.21.6 (every consumer row byte-identical to that consumer's committed copy), a stale BearsMockDraft example, and Versioning (`release.yml` tags, not a human). CLAUDE.md's "~5 KB" escaper is 1.7 KB; `eslint.config.mjs` said C0/C1 where the regex is C0 + DEL; this file's tag command sorted as text and returned `v0.9.2`. **Delivery:** all six consumers carry v0.13.3 — JFS-Sports moved `1d8e9fc` → `39ffd45` via its #720 today. No upstream probe (this repo owns none). **Open:** retiring `isAnyModalOpen` (a minor bump and six re-vendors — a decision); a committed lockfile (reverses a standing choice); the consumer `--pick` invariant (needs sibling checkouts — vendor-cli's liveness monitor is the place); owner: `FAMILY_READ_TOKEN` (Vendor-cli #60) and the leftover branch. |
| 2026-09-22 | plan written | Wrote this half; turned on `maintenance-check: true` in `test.yml`. Verified against the Actions API rather than assumed: the kit-pin bump is HEALTHY here (last six scheduled runs green; PR #54 opened and merged by the bot, so the create-PR repo setting is granted), but its first scheduled run (2026-08-10) and a 2026-08-17 dispatch both failed with no signal. `dependabot-merge.yml` has fired 8 times and concluded `skipped` every time — its merge path has never run in this repo. `main`'s HEAD (`5468b98`) has no `Test` run, because a bot merge with the default `GITHUB_TOKEN` fires no workflows. Gate re-run clean: lint silent, `policy:check` 2 regions in sync, 200/200 tests, `npm audit --omit=dev` 0 vulnerabilities. **Delivery is the open item**: five consumers pin HEAD, JFS-Sports pins `1d8e9fc` (v0.13.2) and so ships the un-hardened `el()` and `safeUrl`/`safeImageUrl` from before v0.13.3. One held major (jsdom 29→30, PR #51, 13 days open, needs a rebase and raises the dev-time Node floor to 22.22.2). Three README claims are stale, including one that describes a generator behavior retired at vendor-cli 0.20.0. |

<!-- maintenance-check:allow
.github/workflows/ci.yml     # named only to record that this repo has none: its CI workflow is test.yml, named `Test`
.github/workflows/smoke.yml  # named only to record that no repo but market-monitor has one, so nothing here reports a failed cron
-->

<!-- jfs-family-maintenance:start — managed by jfs-maintenance-sync; edit family/maintenance.md in @jfs/vendor-cli -->

## Family maintenance protocol

This section is identical across every repo in the @jfs family. It is managed
by `jfs-maintenance-sync` (@jfs/vendor-cli) and checked by family CI — edit
`family/maintenance.md` in the vendor-cli repo, not here.

It covers what is true of **every** repo. What is true of THIS one — its
automation inventory, its upstreams, its invariants, its diagnosis ladder — is
the repo-specific half of this file, above.

### What the automation does, and what it deliberately leaves

Four reusable workflows in `@jfs/vendor-cli` carry the whole family's upkeep.
A repo calls the ones that apply to it:

| Workflow | Fires | Lands by itself | Leaves for a session |
| --- | --- | --- | --- |
| `family-ci.yml` | every push, every PR, `workflow_dispatch` | — it *is* the gate | nothing |
| `dependabot-merge.yml` | when CI completes on a Dependabot PR | every bump that is minor or patch, squash-merged on green | **every major**, and any PR body it can't parse |
| `kit-pin-bump.yml` | weekly, Mondays ~06:41 UTC | the `@jfs/*` pins, the re-vendor, the CLAUDE.md conventions block, the version bump | nothing, when it works |
| `release.yml` | CI green on `main` | the `v<version>` tag and its GitHub release | nothing |

Three gaps follow from that table and they are the whole reason this protocol
exists. They are not oversights; each is a deliberate refusal to automate a
judgement call, and each therefore needs a cadence instead.

**1. Majors accumulate, and the backlog is not inert.** A major is a
judgement, not a merge, so `dependabot-merge.yml` leaves it open. Nothing
schedules the session that makes the judgement, and `.github/dependabot.yml`
caps open PRs. Once the cap is full of unreviewed majors, the weekly
minor/patch PR — the one the automation *does* land — stops being opened at
all. The backlog turns from a to-do list into a block on the working half of
the pipeline.

**2. CI cannot check prose, or anything whose halves live in different
files.** Every repo's gate parses what it ships, lints it, regenerates the
vendored copies, checks the version stamp and runs the suite. None of that
notices that CLAUDE.md describes a module that moved, or that a value added to
one file has no matching entry in the two others that must agree with it. The
family's answer is the same every time and it is worth repeating: **an
invariant whose halves live in different files belongs in a test, not a
comment.** Prose does not hold. Where a cross-file rule is still only written
down, the monthly sweep is what checks it, and mechanizing it is the standing
work.

**3. Nothing watches the upstreams.** Every feed, API, scraped page and
published dataset belongs to somebody else, and these apps fail soft by
design: an upstream that 404s, moves, rate-limits the deploy's egress IP or
starts answering with a bot wall yields less content, one line in a
diagnostics payload, and a green CI run. The only way to notice is to look.

And one standing limitation that applies to every repo here: **the suites fake
the network.** That is what makes them fast, offline and safe to run
air-gapped, and it is exactly why a breaking change in a client library or an
upstream's payload shape ships green. A green suite is evidence about this
repo's code. It is never evidence about its dependencies' behaviour, and never
evidence that the deploy works.

### Who watches the watchers

The automation above is what makes fourteen repos maintainable with the owner
away, which makes a silent failure *in the automation* the highest-severity
failure mode in the family — and until this protocol existed, nothing watched
it at all.

The failure is not hypothetical and it is not rare. A `workflow_run` that
fails on a schedule produces no issue, no comment and no message anyone reads;
it leaves a red mark on a page nobody opens. Measured on 2026-09-22: the
weekly kit-pin bump had failed on **every** scheduled run for four to five
weeks in four repos, from two unrelated causes, with no signal of any kind.
Three of them had pushed a correct bump to an `auto/kit-pin-bump` branch that
no pull request was ever opened for. One patch release of the vendoring
generator had gone unvendored family-wide as a result — the same class of
failure the vendor-cli notes already record happening once before, fixed at
the source, and recurred by a different mechanism.

So the weekly check below is not optional hygiene. It is the one cadence that
protects every other cadence, and it asks four questions:

1. **Did each scheduled workflow's last run succeed?** Not "is `main` green" —
   a scheduled run fails on its own page. Check the run, not the branch.
2. **Is there a stranded `auto/*` branch?** A branch with commits and no open
   PR means the automation did its work and could not deliver it. On any repo:
   `git ls-remote --heads origin 'refs/heads/auto/*'` against the open PR list.
3. **Are the `@jfs/*` pins actually current?** A repo whose pins sit behind
   every sibling's is a repo whose bump is not landing, whatever its workflow
   page says. Compare the pins across repos, not against hope.
4. **Is any bot PR older than seven days, red, or conflicted?**

A clean week needs no action. Say so and stop.

### The cadences

#### Every change — before the push

These are the existing rules, restated so the protocol is complete in one
place:

- Run the repo's own gate command — the same steps CI runs, so the two cannot
  drift. Push only once it is clean.
- Bump the version and run the stamper whenever a **shipped asset** changes.
  Every app here serves its shell from a versioned service-worker cache, so a
  missed bump leaves returning visitors on the stale build — the exact failure
  the family flow exists to prevent. A change that never reaches the browser
  needs no bump.
- Never hand-edit generated output: a vendored kit copy, a stamped constant, a
  baked dataset. Bump the pin and re-run the generator; the copies are
  reviewed as bundler output, not as source.
- A new external resource changes the CSP, in **every** file that declares one.
- Docs change in the commit that makes them wrong, not in a later sweep.
- Open the PR ready for review, dispatch CI, and merge on green — a
  session-pushed branch fires no `pull_request` workflows, so a dispatched run
  on the head commit is the only gate there is.

#### Weekly — pipeline hygiene (~10 minutes)

The four questions under "Who watches the watchers". Nothing else.

#### Monthly — the sweep (~1 hour)

Work the sections in this order, because each one's output feeds the next:

1. **Cross-file drift** — fix first. A failure means two files that must agree
   no longer do, and where the check is gated, CI is already red.
2. **Dependency currency** — every outstanding major goes through the triage
   below. Record the verdict; do not re-derive last month's no.
3. **Advisories** — a high or critical in a *shipped* dependency already has
   CI red where the prod-audit gate is on. When no version bump resolves it —
   an upstream pinning a vulnerable transitive exactly — an `overrides` entry
   is the family's escape hatch.
4. **Upstreams** — probe the ones this repo owns a probe for, and read the
   result against its documented caveats. A datacenter IP gets a correct 403
   from Cloudflare-fronted hosts; the probe reports it and cannot tell you
   which it is.
5. **Delivery** — confirm the version being served is the one that shipped.
   See "Green CI is not delivered".
6. Add a row to the run log at the bottom of this file.

#### Quarterly, or whenever a signal says so

- **Runtime floor.** `engines.node` (or the language equivalent) against what
  upstream still supports and against the floors the outstanding majors
  demand. This is the single decision that most often unblocks a stuck major
  backlog, and it is a runtime decision before it is a dependency one.
- **Platform.** The function runtime, the bundler, the header set, the actions
  pinned by SHA — a pinned third-party action ages into a deprecated runner.
- **Security re-read.** The SSRF guards, the rate limits, the origin gates,
  what the public diagnostics endpoint discloses, and whether every key is
  still scoped, spend-limited and rotatable.
- **Upstream inventory.** Not "does it answer" but "is it still the right
  source" — a feed that died, a sanctioned route that now exists where a proxy
  was used, a pinned figure that has rotted.

### Major-bump triage

"Does CI pass?" is the wrong question for a major, because the suite fakes the
network. Work these in order and stop at the first step that says hold.

**1. Inventory the call sites.** Grep the import; read every use. Most majors
turn out not to touch the API this repo actually calls. Write down what you
depend on before reading a single release note.

**2. Check the engine floor** against the runtimes that really execute the
code — not only the declared floor, but the function runtime, the build image
and whatever the local entry point runs. A major that raises the floor is a
runtime decision first. Decide the floor, then come back.

**3. Prove it, at the bar the dependency's class demands.**

| Class | What counts as proof |
| --- | --- |
| Pure JS the suite really exercises | the repo's gate command |
| Native module | a scratch script reproducing this repo's *exact* usage against the new version — and whether it installed a prebuilt binary or compiled from source, which changes CI time and can fail on the build image |
| A client the suite **fakes** | nothing the suite can say. Diff the real export surface between the versions and read the call sites by hand |
| Browser-shipped | whatever gate executes the real module graph — a link error is invisible to a linter and arrives as `undefined` under a bundler-transformed test runner |

**4. Land it.** One major per PR unless they are genuinely independent and all
trivially verified. Bump the version only if a shipped asset changed — a
dependency bump that touches nothing shipped must not churn the
service-worker cache name.

**5. Or hold it — visibly.** A major that should not land gets a row in this
file's deferred table, with the reason and **the condition that would change
the answer**. The bot keeps the PR open either way; the table is what stops
the next session spending an hour re-deriving the same no.

### Green CI is not delivered

CI going green means the code is sound. It does not mean anyone received it.
The deploy is a second gate, it runs after CI, and it can fail on its own —
and when it does, nothing breaks and nothing says so: the platform keeps
serving the last good build, the stamped version never moves, no update pill
ever appears, and the change is simply absent for everyone. That is the same
shape as a stale dataset — every automated check green, the product quietly
not doing the new thing.

So after a merge, confirm that the build being served is the one that shipped:
compare the version in the repo against the version the live site reports and
against the one its service worker carries. Three agreeing numbers is delivery
confirmed. The last two lagging the first means the deploy failed or has not
finished.

### What a maintenance session must not do

- **Do not "clean up" a load-bearing irregularity.** Every repo here carries
  measured numbers, deliberate fallback orderings and odd-looking guards that
  encode a bug already paid for. Each repo lists its own above; the rule is
  that an oddity with a comment recording a measurement is evidence, not
  cruft. Simplify the interior freely. Before simplifying anything that
  touches a boundary, make sure that boundary's checks exist and pass.
- **Do not weaken a gate to make it pass.** A skipped test, a loosened
  assertion and a silenced linter rule all read as green. If a check is wrong,
  fix or delete it deliberately and say why; if it is right, fix the code.
- **Do not let a check pass quietly when it could not run.** "Could not check"
  must never be reportable as "fine" — the one failure mode that makes a
  monitor worse than no monitor. Keep the exit codes distinct.
- **Do not extract a kit to solve a duplication.** The bar is a third
  consumer *and* drift that has already caused a real bug or a manual
  reconciliation. Prefer growing an existing kit.

### The run log

Every sweep ends with a row in the repo-specific run log: the date, the
cadence, and what was actually found and done — including "clean". A sweep
that leaves no trace is a sweep the next session will repeat from scratch, and
the log is the only record of why a held major is still held.

<!-- jfs-family-maintenance:end -->
