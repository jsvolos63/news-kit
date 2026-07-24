# @jfs/news-kit — working notes for Claude

Shared, dependency-free news primitives (RSS parsing, dedupe,
classification, escaping, CORS proxy race, relative time, HTML
sanitizing, news-river rendering) extracted from the JFS family of apps.
Consumers vendor this kit via its own CLI rather than installing it at
runtime, so a change here reaches an app only once that app bumps its pin
and re-runs `vendor:sync`.

## Pull requests

Open pull requests **ready for review — never as drafts.** This applies to
PRs opened by automated Claude Code sessions too: some hosted environments
default to creating drafts, so mark the PR ready as part of opening it
rather than leaving it for a follow-up.
