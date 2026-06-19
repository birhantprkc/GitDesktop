# GitDesktop — agent guide

An AI-native, keyboard-first Git desktop client (Tauri 2 + React 19), with an Astro
marketing site in `site/`. This file is the standing brief for Claude/agents; the
full human conventions live in [CONTRIBUTING.md](CONTRIBUTING.md), product intent in
[PRODUCT.md](PRODUCT.md), and ongoing project state in `memory/` (auto-loaded).

## Keep docs in sync with features — every time, unprompted

**When you add or ship a user-facing feature, update its docs in the SAME change —
don't wait to be asked:**

1. **`README.md`** — add/extend the relevant bullet under *Highlights* and/or *Features*.
2. **Marketing site** (`site/src/pages/index.astro`) — add the feature to the
   `capabilities` list (set `ai: true` only for AI features), and add or extend a
   `FeatureRow` when it warrants a section. The page has two synced views,
   **AI-native** and **Just Git** — put non-AI features in both, AI features in the
   AI view only. Then `cd site && pnpm build` to verify.
3. **`CHANGELOG.md`** — add an entry under `## [Unreleased]` (existing convention,
   for any user-facing change, written for humans).

If a feature is too minor for the README/site, it's fine to add only the capability
line + changelog — but make the call deliberately, don't skip silently.

**Screenshots:** marketing-site screenshots for the **Just Git** view must be
captured with the app's *Settings → General → Hide AI features* ON, so they match
the AI-hidden experience. (See `memory/site-just-git-screenshots.md`.)

## Everyday commands

```sh
pnpm build      # typecheck (tsc) + bundle the frontend
pnpm lint       # Biome (format + lint) — run before committing
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
cd site && pnpm build   # build the marketing site
```

## A few house rules (see CONTRIBUTING.md for the rest)

- **Conventional Commits** with a scope: `feat(github,issues): …`, `fix(diff): …`.
- **Don't edit `src/components/ui/`** — those are vendored shadcn/Base UI primitives;
  fix at the feature/call-site level.
- **Keyboard-first, WCAG AA** — wire arrow-key nav for any new selectable list in the
  same change; never convey meaning by color alone; keep destructive paths confirmed.
- The site deploys to Cloudflare Pages at `gitdesktop.app` (`base: "/"`).
