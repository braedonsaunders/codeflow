# Preview guard fixture

This file exists purely to prove the XSS Vulnerability rule now skips
non-production paths: markdown files are excluded via `isNonProductionPath`
regardless of what code-like text they contain.

```tsx
dangerouslySetInnerHTML={{ __html: rawUserBio }}
```
