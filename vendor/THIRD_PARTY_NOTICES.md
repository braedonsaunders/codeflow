# Third-party browser dependencies

CodeFlow vendors these pinned browser assets so local analysis can start without network access.
The exact source URL and SHA-256 digest for every distributed asset are recorded in `manifest.json`.

| Package | Version | License | License text |
| --- | --- | --- | --- |
| `react` | `18.2.0` | MIT | [`licenses/react-LICENSE.txt`](./licenses/react-LICENSE.txt) |
| `react-dom` | `18.2.0` | MIT | [`licenses/react-dom-LICENSE.txt`](./licenses/react-dom-LICENSE.txt) |
| `@babel/standalone` | `7.23.5` | MIT | [`licenses/babel-standalone-LICENSE.txt`](./licenses/babel-standalone-LICENSE.txt) |
| `d3` | `7.8.5` | ISC | [`licenses/d3-LICENSE.txt`](./licenses/d3-LICENSE.txt) |
| `d3-sankey` | `0.12.3` | BSD-3-Clause | [`licenses/d3-sankey-LICENSE.txt`](./licenses/d3-sankey-LICENSE.txt) |
| `acorn` | `8.11.3` | MIT | [`licenses/acorn-LICENSE.txt`](./licenses/acorn-LICENSE.txt) |
| `jsrsasign` | `11.1.0` | MIT | [`licenses/jsrsasign-LICENSE.txt`](./licenses/jsrsasign-LICENSE.txt) |
| `jszip` | `3.10.1` | MIT OR GPL-3.0-or-later | [`licenses/jszip-LICENSE.txt`](./licenses/jszip-LICENSE.txt) |
| `web-tree-sitter` | `0.20.8` | MIT | [`licenses/web-tree-sitter-LICENSE.txt`](./licenses/web-tree-sitter-LICENSE.txt) |
| `jspdf` | `2.5.1` | MIT | [`licenses/jspdf-LICENSE.txt`](./licenses/jspdf-LICENSE.txt) |
| `mermaid` | `10.9.1` | MIT | [`licenses/mermaid-LICENSE.txt`](./licenses/mermaid-LICENSE.txt) |
| `3d-force-graph` | `1.80.0` | MIT | [`licenses/3d-force-graph-LICENSE.txt`](./licenses/3d-force-graph-LICENSE.txt) |
| `tree-sitter-wasms` | `0.1.13` | MIT | [`licenses/tree-sitter-wasms-LICENSE.txt`](./licenses/tree-sitter-wasms-LICENSE.txt) |
| `@fontsource/jetbrains-mono` | `5.3.0` | OFL-1.1 | [`licenses/fontsource-jetbrains-mono-LICENSE.txt`](./licenses/fontsource-jetbrains-mono-LICENSE.txt) |

Regenerate the checked-in files with `node scripts/vendor-browser-deps.mjs`.
