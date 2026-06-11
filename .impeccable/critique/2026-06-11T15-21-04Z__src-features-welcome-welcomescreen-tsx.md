---
target: welcome screen
total_score: 25
p0_count: 0
p1_count: 2
timestamp: 2026-06-11T15-21-04Z
slug: src-features-welcome-welcomescreen-tsx
---
# Critique: Welcome Screen

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Clicking a repo row gives no feedback while validateRepo runs; dialogs are solid (spinners, "Cloning…") |
| 2 | Match System / Real World | 3 | Good git vocabulary throughout; "(change in Settings)" hint is terse |
| 3 | User Control and Freedom | 3 | Destination inputs are readOnly — cannot type or paste a path, Browse is the only way |
| 4 | Consistency and Standards | 2 | Native checkbox vs shadcn Checkbox; "Browse" vs "Choose…" for the same action; rounded-none list under a rounded Card |
| 5 | Error Prevention | 3 | Buttons disabled until valid; folder pickers prevent bad paths |
| 6 | Recognition Rather Than Recall | 3 | Everything visible and labeled; the remove-X is invisible until hover |
| 7 | Flexibility and Efficiency | 1 | No keyboard path at all: no autofocus, no arrow keys, no Enter-to-open, no drag-and-drop |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and restrained; duplicate "GitDesktop" branding (OS title bar + header), large dead zones |
| 9 | Error Recovery | 3 | toastError with Copy action; not-a-repo toast offers "Remove" — genuinely good |
| 10 | Help and Documentation | 1 | None anywhere (no tooltips, no docs link) |
| **Total** | | **25/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment**: Passes the product slop test — no gradients, glass, hero metrics, or eyebrow scaffolding. Risk runs the opposite direction: default-shadcn generic. Pure-neutral palette (primary button is white), stock spacing/card. Only identity is JetBrains Mono.

**Deterministic scan**: detect.mjs on src/features/welcome + RepoList.tsx — 0 findings, exit 0.

**Visual evidence**: No browser overlay possible (Tauri webview); native window screenshot via gd-ui.ps1 confirmed live layout matches source.

## Priority Issues

- **[P1] The primary surface is mouse-only** — no filter autofocus, no arrow-key navigation, no Enter-to-open in RepoList.tsx. Fix: autofocus input, roving highlight, Enter opens first/highlighted match. → $impeccable harden
- **[P1] Remove-X invisible to keyboard users** — RepoList.tsx:99 `opacity-0 group-hover:opacity-100` leaves a focusable invisible control; WCAG AA failure. Fix: add `focus-visible:opacity-100`. → $impeccable audit
- **[P2] Inconsistent component vocabulary** — native checkbox in CreateRepoDialog.tsx:145 vs shadcn Checkbox elsewhere; "Browse" (CloneRepoDialog.tsx:94) vs "Choose…" (CreateRepoDialog.tsx:141); rounded-none list (RecentRepoList.tsx:14) under rounded Card. → $impeccable polish
- **[P2] readOnly destination inputs block typing/pasting paths** in clone/create dialogs. Fix: editable inputs + Browse assist, validate on submit. → $impeccable harden
- **[P3] Zero accent color** — calm ≠ colorless; one restrained accent for primary actions/selection/focus, defined in App.css. → $impeccable colorize

## Persona Red Flags

**Alex (Power User)**: cannot open a repo without the mouse; cannot paste a clone destination; no drag-folder-to-open.
**Jordan (First-Timer)**: zero-repo state hides the list section entirely (RecentRepoList.tsx:7 returns null) instead of teaching; clone credential failure has no pointer.
**Sam (Accessibility)**: tab order lands on invisible remove button; 11px muted path text near the 4.5:1 line in light mode (0.556 on white).

## Minor Observations

- Duplicate "GitDesktop" branding (OS title bar + in-app header).
- No pending feedback on repo-row click while validateRepo runs.
- CloneRepoDialog resets url but keeps destination after success.
- Get Started card's three buttons can wrap awkwardly at narrow widths (non-wrapping flex row).

## Questions to Consider

- What does a developer with 40 repos see here — is the capped max-h-96 box still the right frame when the list is the only content?
- Is this surface eventually a command palette (Ctrl+P → type → Enter) with the welcome screen as its first-run face?
- What's the one visual element a user would recognize GitDesktop by with the title bars cropped?
