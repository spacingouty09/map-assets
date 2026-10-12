# AGENTS.md: map-assets

Instructions for AI coding tools (Cursor, Grok, Claude Code, Codex and others) and a quick reference for people. The full guides are [README.md](README.md) (setup, API, use in a website) and [CONTRIBUTING.md](CONTRIBUTING.md) (how to change data and release).

## What this repo is

The shared 3D map of signature spots in Kuala Lumpur (now Mid Valley `klec-midvalley` and KLCC `klcc`; Pavilion next): OpenStreetMap-derived data per spot in `areas/<id>/`, the pipeline that builds it from each spot's `rules.json`, cited sources, and a Three.js model. Websites include this repo as a git submodule at `map-assets/`, import `@map-assets` and load the spots they show with `loadArea(id)`. A change here reaches a website only when that website moves its submodule to a newer tag.

## First-time setup

When someone asks you to set them up (usually with the prompt in README, "Quick start with an AI agent"). If you can't run commands yourself, give them to the person one at a time and wait for the output.

- **This folder is `<website>/map-assets/`** (inside a website checkout): set up from the website's AGENTS.md instead, and don't run `npm install` here.
- **This is a standalone clone** (map work only):
  1. `npm ci`
  2. `npm run typecheck && npm run data:check`. Both must pass.
  3. Start `npm run example`, leave it running, and give the person http://127.0.0.1:5174/ (the model on its own; `?area=klcc` for KLCC).
  4. Read [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md) and follow them from now on.
  5. Tell them, in a few lines: each spot lives in `areas/<id>/` with `data/` (generated), `sources/` (cited inputs) and `rules.json` (what the pipeline needs to know); `src/` is the model; a change goes branch → edit `sources/`, `rules.json` or `pipeline/` → `npm run data:process && npm run data:check` → pull request → release tag → each website moves its pointer. `.github/CODEOWNERS` says who reviews which spot. The repo is public: anyone can clone it, but pushing a branch needs write access, so without it the pull request comes from a fork (CONTRIBUTING.md § 4). Then ask what they want to work on.

Don't commit, push, open pull requests or change global git settings without asking.

## Rules

- **Never edit generated files by hand:** `areas/<id>/data/`, `areas/index.json`, `src/areas.gen.ts` and `src/areas/*.gen.ts`. Change `sources/`, `rules.json`, `area.json` or `pipeline/`, then run `npm run data:process`, and commit the source change and the regenerated files together.
- **Spot-specific knowledge goes in that spot's `rules.json`**, not in `pipeline/` or `src/`. The pipeline and the model stay generic, so a new spot needs data and rules, not code.
- **Every number needs a source.** Cited values go in `sources/` with publisher, URL and fetch date. Anything guessed is flagged as an estimate (`heightSource: 'estimate'`), never typed in as fact.
- **Keep `src/` free of the DOM.** No `document`, `window` or `getComputedStyle`: colours come in through a `Palette`, time and motion flags through `MapModel.update()`. Websites own the renderer, camera and UI.
- **Public API = everything exported from `src/index.ts`, plus the JSON shape in `areas/<id>/data/`.** Renaming or removing an export, changing `SceneMode` or `Palette`, or changing the data shape is a breaking change: bump the minor version (0.x) and say so in `CHANGELOG.md`.
- **Attribution:** map data is © OpenStreetMap contributors (ODbL). Keep the credit in READMEs and in any site that shows the map.
- Do not commit `node_modules/`, `dist/`, logs or `.env` files.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | install (Node 22+) |
| `npm run typecheck` | strict TypeScript check of `src/` and `examples/` |
| `npm run data:process` | rebuild every spot's `data/` and the generated loaders (`-- <id>` for one spot) |
| `npm run data:check` | fail if any generated file isn't exactly what the pipeline makes, e.g. after a hand edit (CI runs this) |
| `npm run example` | the model alone at http://127.0.0.1:5174/ (`?area=<id>`) |
| `npm run data:fetch -- <id>` | re-pull OpenStreetMap into `areas/<id>/raw/` (big diff; say so in the PR) |

## Before you finish a change

```bash
npm run typecheck && npm run data:check && npm run example:build
```

Then follow the release steps in CONTRIBUTING.md if a website needs the change.
