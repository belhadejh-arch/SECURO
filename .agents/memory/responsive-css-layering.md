---
name: Responsive CSS layering
description: The imported frontend is a single HTML file with repeated responsive overrides.
---

When changing responsive spacing in the frontend, the effective rule must be placed in the final CSS block or the earlier layered media queries can silently override it. Keep the app container at least viewport-height for the background, but keep content and screen layouts height-auto with zero artificial top spacing.

**Why:** Repeated legacy responsive blocks previously reintroduced top padding and viewport-height spacing after fixes, making mobile whitespace appear unresolved.

**How to apply:** Search all matching selectors before editing, then add or consolidate a final override for `.content`, `.screen`, `.auth-layout`, and `.app-container`; verify both the top edge and the bottom navigation clearance.