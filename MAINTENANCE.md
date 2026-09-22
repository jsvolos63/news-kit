# Maintaining @jfs/news-kit

This kit's own housekeeping is in good order and can be shown to be: the one
`@jfs` pin is current, `v0.13.3` is tagged, the last six scheduled kit-pin
bumps succeeded, and `npm test` is 200 green. None of that is delivery.
Forty-eight exports reach six other repositories as **committed bundler
output**, and a fix
here changes nothing in any app until that app re-pins this kit and re-runs its
own vendoring — which is why the highest-value fact in this file is that one
consumer is a version behind on a security patch today. The other two things
maintenance here turns on are that this repo holds the family's canonical
sanitizer-policy **source** gate, and that its CI can go red with no commit in
it.

## What runs by itself

| Automation | Fires | Lands by itself | Leaves for a session | How a failure would be noticed |
| --- | --- | --- | --- | --- |
| `.github/workflows/test.yml` → `family-ci.yml@main` (`verify-kit-pins: true`, `maintenance-check: true`, `install-command: npm install`, `version-guard-paths: index.js bin`) | push to `main`, every `pull_request`, `workflow_dispatch` | — it *is* the gate | nothing | red on the PR or the commit — the one automation here that fails where somebody is already looking |
| `.github/dependabot.yml` + `.github/workflows/dependabot-merge.yml` (`workflow_run` on `Test` completed) | npm weekly Tuesday, minor+patch grouped; `github-actions` monthly | every minor/patch bump, squash-merged on green | **every major**, and any PR body it cannot parse | a PR sits open. Nobody is told. One is open now (13 days). |
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

**`dependabot-merge.yml` has never merged anything here.** All eight of its
runs concluded `skipped`. That is not a defect: the only Dependabot PR this
repo has ever had is #51, a **major** (jsdom 29 → 30), which the workflow is
designed to leave open. Run #2 was triggered by `dependabot[bot]` itself, so
the `workflows: [Test]` name match does fire correctly. The *merge* path,
however, has never executed in this repo and is therefore unproven here — the
first grouped minor/patch PR will be its first real test.

**Main's HEAD has no CI run of its own, permanently, after every bump.** The
newest `Test` run on `main` is #118, for `728dc74` (v0.13.3); `main` is at
`5468b98`, the bot's kit-pin bump. A push made with the default `GITHUB_TOKEN`
creates no workflow runs, so neither `Test` nor `Release` fired on it. The
bump workflow's own in-workflow `check-command` is the only evidence that
commit is green, and the pattern repeats every Monday a bump lands. No tag was
missed on this occasion because a kit-pin bump does not move the version — but
the weekly check still has to compare the newest tag against `package.json`
rather than trust `Release`:

```
git ls-remote --tags origin | tail -1
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
| `npm test` | `node --test` — Node's own discovery over the 16 files in `test/`, 200 cases |

All four are offline. `kit-pin-bump.yml` passes three of them as its
`check-command` — it omits `npm run lint`, because a vendor-cli pin bump cannot
change `index.js`. That asymmetry is deliberate and harmless; do not "fix" it
by adding lint there without also asking what else the bump could break.

Checks that run only in CI, with no local spelling:

- the `@jfs` pin pre-flight (`verify-kit-pins: true`), which proves the
  vendor-cli SHA still resolves before `npm install` fails opaquely on it;
- the CLAUDE.md conventions check and, as of this commit, the MAINTENANCE.md
  pair — the canonical-block sync check and the claim check that reads this
  half against the repo;
- the version-bump guard, on pull requests only, over `version-guard-paths:
  index.js bin`.

This repo has **no** `vendor:sync` / `vendor:check` scripts — it vendors
nothing; it *is* the thing vendored — so family-ci's vendor-script-parity step
prints `scripts absent - skipped`. It also does not pass `prod-audit: true`,
unlike five app repos in the family. It has exactly one production dependency
(`@jfs/vendor-cli`, which pulls `esbuild`), and that dependency is real
production surface *for every consumer that installs this package*, so the gate
would not be pointless. `npm audit --omit=dev --audit-level=high` reports 0
vulnerabilities as of 2026-09-22; adding the input is a one-line clean
follow-up.

## What "delivered" means for a kit

The family block's "Green CI is not delivered" applies here with a different
shape: there is no deploy to confirm. Delivery is **six other repositories'
committed vendored copies**, and each one moves only when that repo bumps its
`@jfs/news-kit` pin and re-runs its own vendoring. Measured 2026-09-22:

| Consumer | Pins | Format / picks | State |
| --- | --- | --- | --- |
| John's News | `5468b98` | esm, 9 picks | current |
| Art-Gallery- | `5468b98` | esm, 4 picks | current |
| market-monitor | `5468b98` | esm, 9 picks | current |
| BearsMockDraft | `5468b98` | global, 4 named globals | current |
| Surf-Tracker | `5468b98` | global, 3 named globals | current |
| **JFS-Sports** | `1d8e9fc` | full esm **plus** global, 4 named globals | **4 commits / one version behind (v0.13.2)** |

Weather and FlightCheck deliberately carry no pin at all — each retired it
rather than keep a permanent pin, a drift-gate stage and a weekly bump PR for
two helpers (Weather's `byId` / `elem`, FlightCheck's `byId` / `escapeHtml`),
both now app-owned. Do not read their absence as drift.

JFS-Sports' gap is the one that matters, because the version it is missing is
v0.13.3, a hardening patch. Its vendored copy carries one userinfo strip (the
0.13.0 one, inside `safeContentUrl`) where HEAD carries two, and zero
occurrences of `srcdoc` where HEAD has two. Concretely, JFS-Sports today ships
an `el()` that hands `href` / `src` / `srcdoc` to `setAttribute` verbatim and a
`safeUrl` / `safeImageUrl` pair that returns `https://nytimes.com@evil.com/x`
intact — and it imports `el` in three shipped modules. Whether any of its call
sites
feeds those an untrusted URL is a JFS-Sports question; that the fix is not in
effect there is this repo's. Its own kit-pin bump is the one broken by the
`fetch-data.mjs` credential gap (fixed in vendor-cli this session), so the fix
arrives on its next successful Monday bump — or sooner by dispatch.

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
| The four URL guards diverge exactly as documented | `index.js` ↔ the README table | `test/escape-dedup.test.js` pins every row |
| The generator this kit's shim hands consumers still behaves | `dependencies.@jfs/vendor-cli` ↔ what six repos vendor | `test/vendor.test.js`, which drives the pinned CLI's generator — so a vendor-cli bump that would change what consumers vendor fails **here**, rather than in three consumers' vendoring |
| A shipped change carries a version bump | `index.js`, `bin/` ↔ `package.json` version | family-ci's version-bump guard, pull requests only |
| **Six consumers' `--pick` lists name exports that exist** | `index.js` ↔ six other repos' package.json | **prose only.** All 25 distinct picked names resolve today (checked 2026-09-22). A removed or renamed export refuses loudly at the *consumer's* drift gate — but only on their next re-vendor, which for JFS-Sports means weeks |
| `engines.node: ">=18"` | `package.json` ↔ nothing | **prose only, and unexercised.** The kits pass no `node-version-file` and have no `.nvmrc`, so CI rides family-ci's default Node 22. Nothing here has run on 18 in a long time |
| The README describes the current kit | `README.md` ↔ `index.js`, and ↔ the generator | **prose only, and already drifted** — see Deferred below |

The prose-only rows are the monthly sweep's work. The mechanizable one is the
consumer-pick invariant: a test in this repo that reads the sibling repos'
package.json `vendor:sync` strings and asserts every `--pick` name is in the
derived surface would turn "weeks later, in someone else's CI" into "now, here"
— at the cost of depending on a side-by-side checkout, which is why it is not
written yet.

## What nothing watches

Nothing here talks to an upstream feed, a scraped page or a paid API — the kit
is dependency-free by design and its suite is offline. What rots instead:

- **The six consumers' pins.** Nothing in this repo, and nothing in the family,
  notices that a consumer is a version behind on a security patch. That is how
  today's JFS-Sports gap became a fact nobody had written down. Silent.
- **The canonical sanitizer policy in vendor-cli.** An edit there reddens
  `npm run policy:check` here on the next CI run with no commit in this repo.
  Loud, but it fails in the middle of unrelated work.
- **Floating devDependency ranges.** `package-lock.json` is gitignored, so
  every CI run resolves `eslint ^10.9.1`, `@eslint/js ^10.0.1`, `globals
  ^17.11.0` and `jsdom ^29.1.1` fresh. A new eslint minor that adds a rule to
  `js.configs.recommended` can redden this repo with no change here and no
  Dependabot PR to point at. Loud, and confusing the first time.
- **`bin/vendor.mjs`'s resolution promise.** It runs whatever vendor-cli
  resolves *from inside this package*, which is why the pin is in
  `dependencies` and not `devDependencies` — a consumer installs the former and
  not the latter. If that ever moved, every consumer would silently start
  vendoring through whatever CLI sat at the top of *their* tree. Nothing tests
  the placement. Silent.
- **Runner and action deprecation.** `peter-evans/create-pull-request` is
  SHA-pinned inside the shared `kit-pin-bump.yml` and still targets Node 20,
  which GitHub warns about on every run that reaches it. The warning is in a log
  nobody reads; the eventual removal will simply break the bump.
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

| Dependency | Current → target | Verdict | Why | What would change the answer |
| --- | --- | --- | --- | --- |
| `jsdom` (dev) | 29.1.1 → 30.0.1 (PR #51, open since 2026-09-09; 30.1.1 is already out) | **Land it, after a rebase** | Dev-only, and the call surface is the narrowest possible: nine `new JSDOM(...)` sites across seven files, plus `dom.window.document`. Its class in the family triage is "pure JS the suite really exercises" — those seven files *are* the DOM coverage — so the four gate commands are the proof. Two blockers, both cheap: the PR's base is four commits stale (it still names v0.13.2 and the previous vendor-cli pin), and jsdom 30 declares `node: ^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`, above this package's `engines.node: ">=18"` | Whether that dev-side floor matters to anyone: a contributor, or some future CI job, on Node 18 or 20 could no longer run the DOM tests. family-ci's default Node 22 resolves to 22.22.2 or later, so CI itself is already above the floor. `engines.node` describes the *shipped* module, which imports nothing and still runs on 18 — so land jsdom 30 and record the toolchain floor separately. Do not raise `engines.node` to satisfy a test dependency: it is a promise to consumers |

Two documented-but-unresolved items, both recorded in commit `728dc74`'s own
body:

- **`isAnyModalOpen` has no consumer importer.** A grep of all 13 sibling
  repos found the only hit outside `index.js` to be JFS-Sports' vendored copy
  of the *definition* — which, as CLAUDE.md warns, is the definition, not a
  use. Its removal was in scope for v0.13.3 and was skipped because
  `test/modal.test.js` imports it and asserts on it in six places. Before
  retiring it, check **internal** callers too: `safeContentUrl` looked
  single-consumer and the river renderer was calling it.
- **23 of the 48 exports are named by no consumer `--pick`.** They are not
  therefore dead — JFS-Sports vendors the full esm surface and lets esbuild
  shake it, and several are internal callers' targets — but the list is where a
  retirement candidate would come from. The bar this repo already set:
  `sanitizeUrl` / `sanitizeHref` went back to their single consumer in v0.13.0
  only once both "no internal caller" and "exactly one importer" held.

And three **README defects** found while writing this file, none of them gated
by anything:

- it still says "Every narrowed build keeps the sanitizer-policy marked
  regions, so `jfs-sanitizer-policy-sync --check` still gates the vendored
  copy." vendor-cli 0.20.0 retired that graft: a narrowed build reprints policy
  code like any other code and the generator *strips* the marker lines. The
  source-side gate in this repo's CI is what holds now, and CLAUDE.md says so
  correctly.
- it calls the surface "50-export" twice. It is 48.
- the URL-guard worked-examples table has a stray seventh-column row
  (`http://x/?a=1&b=2`) stranded below the retired-guards paragraph, outside
  the five-column table it belongs to.

The vendored build-size tables are labeled as generated from v0.12.0 with
vendor-cli 0.12.0, which is honest but no longer current — CLAUDE.md records a
uniform −131 B at vendor-cli 0.13.0.

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
   and takes under ten seconds after `npm install`:
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
   200 cases; a behavioral question is almost always faster to answer by adding
   a case than by reading.

## Run log

| Date | Cadence | Found / done |
| --- | --- | --- |
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
