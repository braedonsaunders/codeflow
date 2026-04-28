<div align="center">

# CodeFlow

### Visualize Your Codebase Architecture in Seconds

**Zero setup. No installation. Just paste a GitHub URL.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

[**Try it Now**](https://codeflow-five.vercel.app/) · [Report Bug](https://github.com/braedonsaunders/codeflow/issues) · [Request Feature](https://github.com/braedonsaunders/codeflow/issues)

<img src="./screenshot.png" alt="CodeFlow Screenshot" width="100%"/>

</div>

---

## :sparkles: New: CodeFlow Card — auto-updating repo stats SVG

A one-line GitHub Action that drops a self-updating card on your README, recomputed on every merge by the same analyzer as the web app. Five styles, accent presets, opt-in PR receipts, and a privacy mode for public repos.

<p align="center">
  <img src="./card/examples/compact.svg" alt="compact style" width="100%" />
  <img src="./card/examples/hero.svg" alt="hero style" width="100%" />
  <img src="./card/examples/detailed-private.svg" alt="detailed private style" width="100%" />
</p>

[**See all 10 style variants and full setup** ↓](#card-style-gallery)

---

## Why CodeFlow?

Ever opened a new codebase and felt completely lost? **CodeFlow** turns any GitHub repository or local codebase into an interactive architecture map in seconds.

- **No installation required** — runs entirely in your browser
- **No data collection** — your code never leaves your machine
- **No accounts** — just paste a URL or select local files and go
- **Works offline** — analyze local files without internet

```
Paste URL / Select Files -> See Architecture -> Make Better Decisions
```

---

## Features

### Interactive Dependency Graph
See how your files connect at a glance. Click any node to highlight its dependencies. Drag, zoom, and explore.

### Blast Radius Analysis
*"If I change this file, what breaks?"* — CodeFlow answers this instantly. Select any file and see exactly how many files would be affected by changes.

### Code Ownership
Know who owns what. See the top contributors for any file based on git history. Perfect for code reviews and knowing who to ask.

### Security Scanner
Automatic detection of:
- Hardcoded secrets & API keys
- SQL injection vulnerabilities
- Dangerous `eval()` usage
- Debug statements in production code

### Pattern Detection
Automatically identifies:
- Singleton patterns
- Factory patterns
- Observer/Event patterns
- React custom hooks
- Anti-patterns (God Objects, high coupling)

### Health Score
Get an instant A-F grade for your codebase based on:
- Dead code percentage
- Circular dependencies
- Coupling metrics
- Security issues

### Activity Heatmap
Color files by commit frequency to see which parts of your codebase are most actively developed.

### PR Impact Analysis
Paste a PR URL to see exactly which files it affects and calculate the blast radius of proposed changes.

### CodeFlow Card (GitHub Action)
Auto-updating SVG card on your README — health grade, scale, fragility, hidden costs — recomputed every merge. Optional thermal-receipt PR comments. See [card/](./card/).

### Markdown & Wiki-Link Graph
Point CodeFlow at an Obsidian vault or any markdown directory to see notes as a connected graph. Both `[[wiki-links]]` and `[text](./relative.md)` links become edges; each note is a `note`-layer node (distinct color) with a `dependencies[]` array in the JSON export.

### Local File Analysis
Analyze code directly from your computer without uploading to GitHub:
- **Privacy First:** Your code never leaves your machine
- **Offline Support:** Works without internet connection
- **Drag & Drop:** Simply drag files or folders to analyze
- **Folder Scanning:** Recursively analyze entire project structures
- **Exclude Patterns:** Skip attachments, caches, generated assets, and other irrelevant paths before scanning
- **Instant Results:** All processing happens in your browser

---

## Privacy First

**Your code stays on your machine.** CodeFlow:

- Runs 100% in the browser
- Makes API calls directly from your browser to GitHub
- Never stores your code or tokens
- Works with private repos (just add your token locally)
- No analytics or tracking

Your GitHub token (if used) is only stored in your browser's memory and is cleared when you close the tab.

---

## Quick Start

### Option 1: Use Online (Recommended)
Just visit [CodeFlow](https://codeflow-five.vercel.app/) and paste any GitHub URL.

### Option 2: Self-Host
```bash
# Clone the repo
git clone https://github.com/braedonsaunders/codeflow.git

# That's it! Just open index.html in your browser
open index.html
```

No build process. No npm install. It is a single `index.html` app that loads pinned browser dependencies from CDNs.

### Option 3: Analyze Local Files
You can now analyze code directly from your local machine without uploading to GitHub:

1. Open CodeFlow in your browser
2. Click the "Open Folder" button
3. Select the folder or files you want to analyze
4. CodeFlow will process them entirely in your browser

**Perfect for:**
- Private projects you don't want to upload
- Offline development
- Quick local analysis before committing
- Working with sensitive code

---

## Usage

### Public Repositories
```
Just paste: facebook/react
Or full URL: https://github.com/facebook/react
```

### Private Repositories
1. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope
2. Paste it in the Token field
3. Analyze your private repos

### Local Files
Click the "Open Folder" button to analyze code from your computer:
- **Folder Analysis:** Select a folder to analyze all supported files recursively
- **File Selection:** Choose specific files to analyze
- **Drag & Drop:** Drag files or folders directly onto the page
- **Custom Excludes:** Add patterns like `uploads/**`, `**/cache/**`, or `*.png` before scanning

All processing happens locally in your browser - nothing is uploaded.

### Shareable Links
After analysis, click the "Share" button to copy a shareable link. Anyone can re-run the same analysis.

### Export Reports
Export your analysis in multiple formats for further processing:

- **JSON Report** - Complete analysis data including:
  - Repository metadata and health score
  - All files with functions, dependencies, and churn data
  - Complete function statistics with callers and usage metrics
  - Security issues, patterns, and architecture issues
  - Duplicate code detection and layer violations
  - Suggestions and recommendations
  - Language breakdown and folder structure
  
  Perfect for programmatic analysis, CI/CD integration, or custom reporting tools.

- **Markdown Report** - Human-readable formatted report
- **Plain Text Report** - Simple text format
- **SVG Image** - Export the dependency graph visualization
- **Raw JSON** - Simplified data export

Click the "Export" button in the top bar after analysis to access all export options.

---

## Supported Languages

CodeFlow extracts functions and analyzes dependencies for:

| Language | Extensions |
|----------|------------|
| JavaScript | `.js`, `.jsx` |
| TypeScript | `.ts`, `.tsx` |
| HTML (inline scripts) | `.html`, `.htm`, `.xhtml` |
| Python | `.py` |
| Java | `.java` |
| Go | `.go` |
| Ruby | `.rb` |
| PHP | `.php` |
| Vue | `.vue` |
| Svelte | `.svelte` |
| Rust | `.rs` |
| C | `.c`, `.h` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` |
| C# | `.cs` |
| Swift | `.swift` |
| Kotlin | `.kt`, `.kts` |
| Scala | `.scala`, `.sc` |
| Groovy | `.groovy`, `.gvy` |
| Elixir | `.ex`, `.exs` |
| Erlang | `.erl`, `.hrl` |
| Haskell | `.hs`, `.lhs` |
| Lua | `.lua` |
| R | `.r`, `.R` |
| Julia | `.jl` |
| Dart | `.dart` |
| Perl | `.pl`, `.pm` |
| Shell | `.sh`, `.bash`, `.zsh`, `.fish` |
| PowerShell | `.ps1`, `.psm1`, `.psd1` |
| F# | `.fs`, `.fsi`, `.fsx` |
| OCaml | `.ml`, `.mli` |
| Clojure | `.clj`, `.cljs`, `.cljc` |
| Elm | `.elm` |
| VBA | `.vba`, `.bas`, `.cls`, `.xlsm`, `.xlsb`, `.xlam` |

---

## Visualization Modes

| Mode | Description |
|------|-------------|
| **Folder** | Color by directory structure |
| **Layer** | Color by architectural layer (UI, Services, Utils, etc.) |
| **Churn** | Color by commit frequency (hot spots) |
| **Blast** | Color by impact when a file is selected |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Analyze repository |
| `+` / `-` | Zoom in/out |
| `Escape` | Close modal |

---

## API Limits

GitHub API has rate limits:
- **Without token:** 60 requests/hour
- **With Personal Access Token:** 5,000 requests/hour
- **With GitHub App:** 5,000 requests/hour per installation

### Authentication Methods

#### Personal Access Token (PAT)
1. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope
2. Paste it in the Token field
3. Analyze your private repos

#### GitHub App Authentication
For teams and organizations, GitHub App provides better security and higher rate limits:

1. Create a [GitHub App](https://github.com/settings/apps) with repository permissions
2. Install the app on your organization or personal account
3. Generate an installation access token
4. Paste the token in the Token field

**Benefits of GitHub App:**
- Fine-grained permissions control
- Revocable access per installation
- Higher rate limits (5,000 requests/hour)
- Audit logging and security monitoring
- No need to share personal credentials

For larger repositories or team usage, we recommend using GitHub App authentication.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   CodeFlow                      │
├─────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Parser  │  │  GitHub  │  │    D3    │       │
│  │  Module  │  │   API    │  │  Graph   │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│        │              │              │          │
│        └──────────────┼──────────────┘          │
│                       │                         │
│              ┌────────▼────────┐                │
│              │   React App     │                │
│              │  (Single File)  │                │
│              └─────────────────┘                │
└─────────────────────────────────────────────────┘
```

**Zero build dependencies to install.** Everything runs from pinned CDNs:
- React 18
- D3.js 7
- Babel (for JSX)

---

## Contributing

We love contributions! Here's how:

1. Fork the repo
2. Make your changes to `index.html`
3. Test locally (just open in browser)
4. Submit a PR

If you're editing the markdown / wiki-link parser, Node.js unit tests live under `tests/` and run with no dependencies:

```bash
node --test tests/
```

`tests/verify-brain-vault.mjs` is an optional end-to-end script that always verifies the bundled fixtures and will also scan a real local vault when you explicitly set `BRAIN_VAULT=/path/to/vault`.

### Ideas for Contributions
- [ ] Add support for more languages
- [ ] Improve function extraction regex
- [ ] Add more design pattern detection
- [ ] Export to different formats (PNG, PDF)
- [ ] Add code complexity metrics

---

## FAQ

**Q: How does it work without a backend?**
> CodeFlow runs entirely in your browser. It calls the GitHub API directly from your browser and processes everything client-side.

**Q: Is my code safe?**
> Yes. Your code is fetched directly from GitHub to your browser. Nothing is sent to any server we control. Check the source — it's one file!

**Q: Can I use it offline?**
> Yes. With the local file analysis feature, you can analyze code from your computer without any internet connection. Click the "Open Folder" button and select your files. All processing happens entirely in your browser.

**Q: Why is analysis slow?**
> We make individual API calls for each file to get content. With a token, you get higher rate limits and faster analysis.

**Q: How accurate is the dependency analysis?**
> It's based on function name matching, so it may miss some dynamic imports or renamed imports. It's designed for a quick overview, not 100% accuracy.

---

## Card Style Gallery

All examples below are real cards rendered by the [CodeFlow Card Action](./card/) against this very repo. Pick one and drop it on your README.

### `style: compact` — default

<img src="./card/examples/compact.svg" alt="compact" width="100%" />

### `style: compact` with `show-grade: false, show-score: false`

For public READMEs where you'd rather show data than a letter grade. The card stays informational — files, functions, LOC, languages, tests — without the judgmental bits.

<img src="./card/examples/compact-private.svg" alt="compact private" width="100%" />

### `accent` — any preset or CSS color

The accent recolors the sparklines, links, and pin. Presets: `purple` (default), `teal`, `cyan`, `green`, `pink`, `blue`, `amber`, `red`. Or pass any CSS color (e.g. `#ff6b6b`).

<img src="./card/examples/compact-teal.svg" alt="compact teal" width="100%" />
<img src="./card/examples/compact-pink.svg" alt="compact pink" width="100%" />

### `style: row` — status-bar strip

<img src="./card/examples/row.svg" alt="row" width="100%" />

### `style: minimal` — single text line

<img src="./card/examples/minimal.svg" alt="minimal" width="100%" />

### `style: hero` — splashy gradient

<img src="./card/examples/hero.svg" alt="hero" width="100%" />

`hero` with `show-grade: false`:

<img src="./card/examples/hero-private.svg" alt="hero private" width="100%" />

### `style: detailed` — information-rich

Everything: grade, scale, language breakdown, composition (connections, tests, folders, function stats, patterns), top folders, fragility, hidden costs.

<img src="./card/examples/detailed.svg" alt="detailed" width="100%" />

`detailed` with `show-grade: false`:

<img src="./card/examples/detailed-private.svg" alt="detailed private" width="100%" />

---

## Star History

If you find CodeFlow useful, please star the repo.

---

## License

MIT License — use it however you want.

---

<div align="center">

**Built by developers, for developers**

*Stop guessing. Start seeing.*

</div>
