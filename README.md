<div align="center">

# ⚡ CodeFlow

### Visualize Your Codebase Architecture in Seconds

**Zero setup. No installation. Just paste a GitHub URL.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

[**Try it Now**](https://yoursite.com) · [Report Bug](https://github.com/yourname/codeflow/issues) · [Request Feature](https://github.com/yourname/codeflow/issues)

<img src="https://via.placeholder.com/800x450?text=CodeFlow+Screenshot" alt="CodeFlow Screenshot" width="100%"/>

</div>

---

## Why CodeFlow?

Ever opened a new codebase and felt completely lost? **CodeFlow** turns any GitHub repository into an interactive architecture map in seconds.

- **No installation required** — runs entirely in your browser
- **No data collection** — your code never leaves your machine
- **No accounts** — just paste a URL and go

```
⚡ Paste URL → See Architecture → Make Better Decisions
```

---

## Features

### 🗺️ **Interactive Dependency Graph**
See how your files connect at a glance. Click any node to highlight its dependencies. Drag, zoom, and explore.

### 💥 **Blast Radius Analysis**
*"If I change this file, what breaks?"* — CodeFlow answers this instantly. Select any file and see exactly how many files would be affected by changes.

### 👥 **Code Ownership**
Know who owns what. See the top contributors for any file based on git history. Perfect for code reviews and knowing who to ask.

### 🔐 **Security Scanner**
Automatic detection of:
- Hardcoded secrets & API keys
- SQL injection vulnerabilities
- Dangerous `eval()` usage
- Debug statements in production code

### 🧩 **Pattern Detection**
Automatically identifies:
- Singleton patterns
- Factory patterns
- Observer/Event patterns
- React custom hooks
- Anti-patterns (God Objects, high coupling)

### 📊 **Health Score**
Get an instant A-F grade for your codebase based on:
- Dead code percentage
- Circular dependencies
- Coupling metrics
- Security issues

### 🔥 **Activity Heatmap**
Color files by commit frequency to see which parts of your codebase are most actively developed.

### 📋 **PR Impact Analysis**
Paste a PR URL to see exactly which files it affects and calculate the blast radius of proposed changes.

### 🎓 **Guided Tours**
Create shareable walkthroughs of your codebase. Perfect for onboarding new team members.

---

## Privacy First

**Your code stays on your machine.** CodeFlow:

- ✅ Runs 100% in the browser
- ✅ Makes API calls directly from your browser to GitHub
- ✅ Never stores your code or tokens
- ✅ Works with private repos (just add your token locally)
- ✅ No analytics or tracking

Your GitHub token (if used) is only stored in your browser's memory and is cleared when you close the tab.

---

## Quick Start

### Option 1: Use Online (Recommended)
Just visit [codeflow.dev](https://yoursite.com) and paste any GitHub URL.

### Option 2: Self-Host
```bash
# Clone the repo
git clone https://github.com/yourname/codeflow.git

# That's it! Just open index.html in your browser
open index.html
```

No build process. No dependencies. No npm install. **It's just one HTML file.**

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

### Shareable Links
After analysis, click 🔗 to copy a shareable link. Anyone can re-run the same analysis.

---

## Supported Languages

CodeFlow extracts functions and analyzes dependencies for:

| Language | Extensions |
|----------|------------|
| JavaScript | `.js`, `.jsx` |
| TypeScript | `.ts`, `.tsx` |
| Python | `.py` |
| Java | `.java` |
| Go | `.go` |
| Ruby | `.rb` |
| PHP | `.php` |
| Vue | `.vue` |
| Svelte | `.svelte` |

---

## Visualization Modes

| Mode | Description |
|------|-------------|
| 📁 **Folder** | Color by directory structure |
| 🏗️ **Layer** | Color by architectural layer (UI, Services, Utils, etc.) |
| 🔥 **Churn** | Color by commit frequency (hot spots) |
| 💥 **Blast** | Color by impact when a file is selected |

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
- **With token:** 5,000 requests/hour

For larger repositories, we recommend using a token.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   CodeFlow                       │
├─────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  Parser  │  │  GitHub  │  │    D3    │      │
│  │  Module  │  │   API    │  │  Graph   │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│        │              │              │          │
│        └──────────────┼──────────────┘          │
│                       │                         │
│              ┌────────▼────────┐               │
│              │   React App    │               │
│              │  (Single File) │               │
│              └─────────────────┘               │
└─────────────────────────────────────────────────┘
```

**Zero dependencies to install.** Everything runs from CDNs:
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

### Ideas for Contributions
- [ ] Add support for more languages (Rust, C++, etc.)
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
> Not currently, as it needs to fetch from GitHub. But you could fork it and add local file support!

**Q: Why is analysis slow?**
> We make individual API calls for each file to get content. With a token, you get higher rate limits and faster analysis.

**Q: How accurate is the dependency analysis?**
> It's based on function name matching, so it may miss some dynamic imports or renamed imports. It's designed for a quick overview, not 100% accuracy.

---

## Star History

If you find CodeFlow useful, please ⭐ the repo!

---

## License

MIT License — use it however you want.

---

<div align="center">

**Built with ⚡ by developers, for developers**

*Stop guessing. Start seeing.*

</div>
