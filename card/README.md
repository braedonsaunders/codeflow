# CodeFlow Card

A GitHub Action that drops a slick auto-updating SVG card on your README — health grade, scale, fragility, hidden costs — recomputed every merge by [codeflow](https://github.com/braedonsaunders/codeflow).

The card uses the **same analyzer** as the codeflow web app. There's no separate parser, no version drift — the Action reads codeflow's `index.html` and runs its analyzer in a Node `vm`.

## Quick start

Drop this file in `.github/workflows/codeflow-card.yml`:

```yaml
name: CodeFlow Card
on:
  push:
    branches: [main]
  pull_request:
    types: [closed]
  workflow_dispatch:

jobs:
  card:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: braedonsaunders/codeflow/card@v1
        with:
          theme: dark
          receipts: false  # set true to post merged-PR comments
```

Then add this to your README:

```markdown
<img src=".github/codeflow-card.svg" alt="CodeFlow card" />
```

The Action commits the rendered SVG to `.github/codeflow-card.svg` (overwriting it on every run) and a small history file at `.github/codeflow-card.json` that powers the sparklines and deltas.

## Inputs

| Input | Default | Description |
|---|---|---|
| `output` | `.github/codeflow-card.svg` | Path to write the card SVG. |
| `state` | `.github/codeflow-card.json` | Path to the JSON history file (sparklines, deltas). |
| `theme` | `dark` | `dark` \| `light`. |
| `panels` | `grade,scale,fragility,hidden-costs` | Comma-separated list. Drop any to exclude. |
| `receipts` | `false` | Post a thermal-receipt-style sticky comment on each merged PR. |
| `sparkline-window` | `30` | Recent runs to keep in state for sparklines. |
| `pin` | `true` | Show the "Powered by codeflow" footer. |
| `commit-message` | `chore: update codeflow card [skip ci]` | Commit message used by the Action. |
| `github-token` | `${{ github.token }}` | Token for committing and posting receipts. |

## What's on the card

- **Health** — letter grade (A+ → F) with delta arrow vs the last run, plus the underlying score.
- **Scale** — files / functions / LOC / languages, each with a 30-run sparkline (after the second run).
- **Fragility** — top 3 highest-blast-radius files. The numbers nobody usually shows.
- **Hidden costs** — circular deps, dead code %, average coupling. Lower-is-better arrows.

## PR receipts (opt-in)

When `receipts: true`, every merged PR gets a sticky comment with a thermal-receipt-style summary of what the merge changed:

```
--- CODEFLOW RECEIPT ---
PR #482  @yourhandle
--------------------------
LOC           +312
functions     +4
dead code     −1
circular deps −1
blast radius  23 → 18 ▼
health        B+ → A- ▲
--------------------------
   thank you for your merge
```

The comment is sticky (updates in place via `<!-- codeflow-card:receipt -->` marker) so re-runs don't spam the PR.

## Notes

- **First run**: with no history yet, sparklines and deltas don't render — the panels degrade gracefully.
- **Permissions**: the workflow needs `contents: write` to commit the SVG, and `pull-requests: write` if `receipts: true`.
- **CI cost**: analysis runs in pure Node (no Docker, no external APIs); typical run is 10–30 seconds depending on repo size.
- **Privacy**: nothing leaves the runner. Same guarantee as the codeflow web app.
