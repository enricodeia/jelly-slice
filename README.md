# Jelly Slice

Slice falling Haribo Goldbears in 60 seconds. Soft-body jelly (XPBD), a knife
that acts physically on the pieces, a streak multiplier (×1.5 · ×2 · ×4 · ×8),
screen-space jelly effects on every cut, and a nickname leaderboard.

Vite + React Three Fiber.

## Run

```bash
npm install
npm run dev        # http://localhost:5220
npm run build      # → dist/
```

Font Awesome Pro icons install from `npm.fontawesome.com`, so `npm install`
needs a Font Awesome package token in your user `~/.npmrc` (never in this
repo). On Vercel the same lines go in an `NPM_RC` environment variable.

## Leaderboard (Supabase)

Without configuration, the leaderboard lives on the player's device, and the
UI says so. To make it global:

1. In the Supabase project, open the SQL editor and run
   [`supabase/schema.sql`](supabase/schema.sql). It creates the `scores` table
   (public read, no direct writes), the `leaderboard` view (best round per
   nickname) and the `submit_score()` function, the only way in, which
   validates each round.
2. Copy `.env.example` to `.env.local` and fill in the project URL and the
   **anon** public key (Project Settings → API). For a deploy, set the same two
   variables in the host's environment.

Rounds are ranked only when nothing was tuned: `?panel` (tuning panel),
`?round=N` (custom length) and `?nointro` (endless practice) are never
submitted.

## URL switches

| Switch | What it does |
|---|---|
| `?panel` | shows the Leva tuning panel (round not ranked) |
| `?round=8` | an 8-second round (testing, not ranked) |
| `?nointro` | skips the menu: endless untimed practice (review tools) |
| `?nospawn` | no automatic drops (staged reviews) |

## Review tools

Puppeteer scripts in `tools/` drive a local Chrome against the dev server:
`flow.mjs` (the whole experience, `ROUND=60` for a ranked round,
`VIEW=phone`), `streak.mjs` (multiplier rules), `cutfilm.mjs` (one cut in slow
motion), `howto.mjs` (the menu's how-to loop), `perf.mjs`, `repro.mjs`,
`mobile.mjs`, `docktrack.mjs`, and `bench-*.mjs` for the solver in Node.
`build-sprite.mjs` re-bakes `public/goldbear-sprite.png` (the menu's 2D bear)
from the 3D bear's shape.
