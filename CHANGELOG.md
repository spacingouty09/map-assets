# Changelog

Versions follow [CONTRIBUTING.md § 5](CONTRIBUTING.md#5-release-maintainers-after-merge): while 0.x, a minor bump means websites must adapt; a patch is data or content only.

## Unreleased (proposed v0.2.1: new spot; existing spots' data unchanged)

- **New spot: Bukit Jalil Sports City** (`bukit-jalil`): Pavilion Bukit Jalil, the National Sports Complex (TM Stadium Nasional, Unifi Arena, the aquatic centre, hockey and squash venues), Bukit Jalil City and Bukit Jalil Recreational Park, around SP17 Bukit Jalil, SP19 Awan Besar and SP20 Muhibbah on the Sri Petaling Line (4). Cited heights for 7 buildings (3 of them planned towers under construction) and a cited `facts.json`.
- **Pipeline (optional rules, no effect on existing spots):** `rules.railLines` (spot-specific line-name patterns, tried before the built-in list), `point` anchors (`{ lat, lon }`), and `near` zone rules (building types within a radius of a point). Duplicate zone ids in `rules.zones` are counted once.

## v0.2.0 (2026-10-12)

**Breaking:** map-assets now holds several spots, so websites load one with `loadArea(id)` instead of importing the data directly. Mid Valley's existing data files are byte-for-byte the same as v0.1.3 (it gains a `facilities.json`), and the model draws it pixel for pixel the same way.

- **Spots:** each spot lives in `areas/<id>/` (`area.json`, `rules.json`, `raw/`, `sources/`, `data/`, `height-sources.md`). Mid Valley moved to `areas/klec-midvalley/` with its history. `sources/climate.json` stays shared.
- **New spot: KLCC** (`klcc`): the Petronas Twin Towers, Suria KLCC, KLCC Park, the KL Convention Centre and Ombak KLCC, around KLCC LRT (KJ10) and Persiaran KLCC MRT (PY21). Cited heights for 10 buildings and a cited `facts.json` (opening dates, park area).
- **API:** `listAreas(kind?)` reads the generated spot index (`areas/index.json`); `loadArea(id)` returns an `Area` (data, `station()`, `findPlace()`, `stationDistance()`, `stats`, `facilities`, `facts`), one lazily loaded chunk per spot. `new MapModel(area, opts)` replaces `new MapModel(opts)`. `groundSamples(area)` / `routeSampleSets(area)` take the area. The module-level data exports (`buildings`, `routes`, `meta`, `stats`, `station()`, `ZONES`…) are gone (use the `Area`; `area.zones` replaces `ZONES`); the old `Area` polygon type is now `Polygon`.
- **Pipeline:** spot-specific rules (zones, precincts, landmarks and podiums, route anchors and pairs, KTM relations, rail lines to measure, model hints) moved from code into each spot's `rules.json`. `npm run data:fetch -- <id>`, `npm run data:process [-- <id>]`; `data:check` covers every spot and the generated loaders. New optional inputs: `sources/facts.json`, `sources/overrides.json`.
- **Data:** `facilities.json` per spot (hotels and serviced apartments, car parks and their entrances by type, bus stops with routes, station entrances). Rail lines gain `py` (MRT Putrajaya) and `mr` (KL Monorail).
- **Model:** an underground view (`SceneMode.underground`): tunnels at a schematic depth (4.5 m per OSM layer step) under a see-through ground, section walls, underground stations and trains in the tunnels. Facility markers (`SceneMode.facilities`, `facilityFocus`, `MapModel.facilityAt`). `ModePatch` for partial `setMode()` calls. Mid Valley-only drawing (Skypark, KTM stops, the KJ17 deck, the KL Eco City outline) now comes from its rules.
- **Transit:** Putrajaya Line (12, #FACA05) and KL Monorail (8, #7DBA00) colours and numbers.
- **Repo:** `.github/CODEOWNERS` (each spot's owner reviews it); README, AGENTS.md and CONTRIBUTING.md cover spots, with an "Add a spot" recipe.

Upgrading a website: point the submodule at v0.2.0, load the spot with `loadArea('klec-midvalley')` before building the scene, pass the `Area` to `MapModel` and read data from it (see README "Use it in a website").

## v0.1.3 (2026-10-12)

Docs only; data, API and model are unchanged from v0.1.2.

- Contributors without write access: the fork route with `gh repo fork` in CONTRIBUTING.md § 4, and in AGENTS.md "First-time setup".
- Release steps use annotated tags, and the how-to commands use `vX.Y.Z` in place of a fixed version, so they don't go stale.

## v0.1.2 (2026-10-12)

Docs only; data, API and model are unchanged from v0.1.1.

- The repo is now **public**: no invite or token is needed to clone it or to fetch it as a submodule in CI. Contributors without write access open pull requests from a fork. The code has no licence yet (public to read, all rights reserved); the map data stays under the ODbL.
- README "Quick start with an AI agent": copy-paste setup prompts for any agent (website + map, or map only), and an AGENTS.md "First-time setup" section they hand over to.

## v0.1.1 (2026-10-12)

Tooling only; data, API and model are unchanged from v0.1.0.

- `npm run data:check` (`pipeline/check-data.mjs`) now checks that `data/` is exactly what the pipeline makes from the current `raw/` + `sources/`. Before, it compared with the last commit, so it failed right after a legitimate `data:process`, before you could commit.

## v0.1.0 (2026-10-12)

First release, split out of [noowxela/klec-midvalley-infographic](https://github.com/noowxela/klec-midvalley-infographic) at `f26ec5c` (history kept for the moved files).

- **Data:** `data/` (was `src/data/`) unchanged, regenerated by `pipeline/process-osm.mjs` (was `scripts/`), which now resolves paths from the repo root, so it runs from any directory.
- **Sources:** `sources/height-sources.json` and `sources/climate.json` (were `scripts/height-sources.json` and `src/data/climate.json`).
- **Model:** `MapModel`, the DOM-free part of the infographic's `World` (buildings, ground layers, rail and trains, footways, routes, landmarks, sun light, shade test). It gets colours from a `Palette` (`LIGHT_PALETTE`, `DARK_PALETTE`) instead of CSS variables, and time and motion flags from `update()`.
- **New:** `src/transit.ts` (line colours and numbers, `publicCode()`), `climate` export, `examples/basic`, CI check.
- **Removed:** `fmt()` (UI formatting now lives in each website).
