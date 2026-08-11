---
name: Responsive CSS layering
description: The imported frontend is a single HTML file with repeated responsive overrides.
---

When changing responsive spacing in the frontend, the effective rule must be placed in the final CSS block or the earlier layered media queries can silently override it. The app shell owns the viewport, while `main.content` is the only vertical scroll container; keep screens content-sized with zero artificial top spacing.

**Why:** Repeated legacy responsive blocks previously reintroduced top padding and viewport-height spacing after fixes, making mobile whitespace appear unresolved. Letting both the document and `main.content` scroll also caused inconsistent touch behavior and clipped lower cards.

**How to apply:** Search all matching selectors before editing, then add or consolidate a final override for `.content`, `.screen`, `.auth-layout`, and `.app-container`; verify the top edge, `content.scrollHeight`, touch scrolling, and bottom navigation clearance.