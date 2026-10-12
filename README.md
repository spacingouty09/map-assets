# map-assets

The shared 3D map of **signature spots in Kuala Lumpur and the Klang Valley**, built from OpenStreetMap. Each spot is a study area of about 1–1.2 km square:

| Spot (`id`) | What it covers | Rail |
|---|---|---|
| **Mid Valley** (`klec-midvalley`) | KL Eco City, The Gardens Mall, Mid Valley Megamall, the two landmark mosques | Abdullah Hukum (LRT KJ17, KTM), Mid Valley KTM |
| **KLCC** (`klcc`) | Petronas Twin Towers, Suria KLCC, KLCC Park, KL Convention Centre, Ombak KLCC; hotels, car parks, bus stops | KLCC (LRT KJ10) and Persiaran KLCC (MRT PY21), both underground |

For every spot it holds:

- **Data:** building blocks with heights, roads, rail, footways and footbridges, walking routes, stations, landmarks and facilities (hotels, car parks, bus stops, station entrances), plus climate normals shared by all spots.
- **The pipeline** that builds the data from OpenStreetMap, driven by each spot's `rules.json`.
- **The cited sources** for every number that doesn't come from OSM.
- **A Three.js model** of it, ready to drop into any website, with an underground view for tunnels.

A website loads only the spots it shows: [map-infographic](https://github.com/spacingouty09/map-infographic) lets visitors switch between spots; a single-site website loads one. Websites include this repo as a **git submodule**. Split out of [noowxela/klec-midvalley-infographic](https://github.com/noowxela/klec-midvalley-infographic) at `f26ec5c` with its history; the massing is illustrative, not a survey.

- **Contributing** (including how to add a spot): [CONTRIBUTING.md](CONTRIBUTING.md)
- **AI tools** (Cursor, Grok, Claude Code…): [AGENTS.md](AGENTS.md)
- **Changes:** [CHANGELOG.md](CHANGELOG.md)

## What's here

```
areas/
  index.json          the spot index (generated): id, name, kind, centre, bounds, stations, lines
  <id>/
    area.json         name, kind (signature | site), centre, half size, summary
    rules.json        what the pipeline needs to know about this spot: zones, landmarks, walking-route
                      anchors and pairs, rail lines, model hints (see CONTRIBUTING.md § Add a spot)
    sources/          hand-curated, cited inputs: height-sources.json, facts.json, overrides.json (optional)
    height-sources.md every cited height, its source and caveats
    raw/              the OpenStreetMap pull (Overpass)
    data/             generated JSON: buildings, lines, areas, stations, routes, landmarks, named outlines,
                      facilities, meta. Never edit by hand.
sources/climate.json  cited climate normals for Kuala Lumpur, shared by every spot
pipeline/             config.mjs (areas), fetch-osm.mjs (raw/), process-osm.mjs (raw/ + sources/ + rules → data/),
                      check-data.mjs
src/
  index.ts            public API (everything below)
  areas.ts            listAreas(), loadArea(id)
  data.ts             types and the Area (data, lookups, derived figures)
  areas.gen.ts, areas/<id>.gen.ts   generated loaders, one lazily loaded chunk per spot
  transit.ts          official line colours, line numbers, public stop numbers
  sun.ts              sun position (NOAA formulas), Malaysia time helpers
  model/              MapModel (the Three.js model), trains, shade sampling, geometry helpers, palettes
examples/basic/       the smallest website using the model (?area=<id>)
```

Coordinates are metres in each spot's local frame: `x` east and `y` north of its centre (`meta.center`). In Three.js, `y` is up and `z = -north`.

## Set up

You need Node 22+. The repo is public, so anyone can clone it. To push branches here, ask for write access; without it, fork the repo on GitHub and open pull requests from your fork.

### Quick start with an AI agent

Copy one of these into your AI coding agent (Cursor, Grok, Claude Code, Codex…). It checks your access, clones, sets everything up and explains how to contribute.

**Usual: the website with the map inside it** (map-infographic is private: ask for an invite first). You see your map changes in a real site:

```text
Set me up to contribute to the KL spots map project (private GitHub repo spacingouty09/map-infographic, with the public spacingouty09/map-assets as a submodule). 1) Check that I have git and Node 22+, and that git can reach the website repo: `git ls-remote https://github.com/spacingouty09/map-infographic.git`. If that fails, stop and tell me exactly what to do (usually: accept the map-infographic invite on GitHub, then run `gh auth login` and `gh auth setup-git`). 2) Ask me which folder to use, then run `git clone --recurse-submodules https://github.com/spacingouty09/map-infographic.git` there. 3) Open the map-infographic folder and follow the "First-time setup" section of its AGENTS.md. If you can't run commands yourself, give them to me one at a time and wait for the output. Don't commit, push or open pull requests without asking me.
```

**Map only:**

```text
Set me up to contribute to the KL spots shared map (public GitHub repo spacingouty09/map-assets). 1) Check that I have git and Node 22+; if not, stop and tell me exactly what to install. 2) Ask me which folder to use, then run `git clone https://github.com/spacingouty09/map-assets.git` there. 3) Open the map-assets folder and follow the "First-time setup" section of its AGENTS.md. If you can't run commands yourself, give them to me one at a time and wait for the output. If I don't have write access to the repo, my pull requests go through a fork; help me set that up when I'm ready. Don't commit, push or open pull requests without asking me.
```

### By hand

```bash
git clone https://github.com/spacingouty09/map-assets.git
cd map-assets
npm ci
npm run typecheck
npm run example        # http://127.0.0.1:5174/ : the model on its own; ?area=klcc for KLCC
```

To change data or the model, follow [CONTRIBUTING.md](CONTRIBUTING.md).

| Command | What it does |
|---|---|
| `npm run typecheck` | strict TypeScript check |
| `npm run data:process` | rebuild every spot's `data/` and the generated loaders; `-- <id>` for one spot |
| `npm run data:check` | fail if any spot's `data/` or the generated files aren't exactly what the pipeline makes (CI) |
| `npm run data:fetch -- <id>` | re-pull OpenStreetMap into `areas/<id>/raw/` |
| `npm run example` / `example:build` | run / build `examples/basic` |

## Use it in a website

Any Vite + TypeScript site works. The steps below are the setup [map-infographic](https://github.com/spacingouty09/map-infographic) uses.

**1. Add the submodule and pin a release.** Use the latest release from [CHANGELOG.md](CHANGELOG.md) in place of `vX.Y.Z`. The repo is public, so no token or invite is needed, in CI either:

```bash
git submodule add https://github.com/spacingouty09/map-assets.git map-assets
git -C map-assets checkout vX.Y.Z
npm install three@0.186.1 && npm install -D @types/three@0.186.0
git add .gitmodules map-assets package.json package-lock.json
git commit -m "Add map-assets vX.Y.Z"
```

In GitHub Actions, check out with `submodules: true` (`actions/checkout`). A site that only reads the map (nobody edits it from inside the site) can add `shallow = true` to its `.gitmodules` entry to keep clones small; leave it off where people edit `map-assets/` in place, because pushing from a shallow clone to a fork can fail.

**2. Point `@map-assets` at it** and keep a single copy of three.js:

`vite.config.ts`

```ts
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const mapAssets = fileURLToPath(new URL('./map-assets/src', import.meta.url));
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@map-assets$/, replacement: `${mapAssets}/index.ts` },
      { find: /^@map-assets\/(.*)$/, replacement: `${mapAssets}/$1` },
    ],
    dedupe: ['three'],
  },
  build: { chunkSizeWarningLimit: 1200 }, // each spot's data is one chunk
});
```

`tsconfig.json` (inside `compilerOptions`; also set `"resolveJsonModule": true`)

```json
"paths": {
  "@map-assets": ["./map-assets/src/index.ts"],
  "@map-assets/*": ["./map-assets/src/*"],
  "three": ["./node_modules/@types/three"],
  "three/*": ["./node_modules/@types/three/*"]
}
```

**3. Load a spot and render it.** `loadArea(id)` downloads only that spot. The model brings its own lights and everything in the study area; your site owns the renderer, camera and UI:

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapModel, LIGHT_PALETTE, listAreas, loadArea } from '@map-assets';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true; // trains are clipped at the study-area edge
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f3f3f1');
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 20, 9000);
camera.position.set(1100, 1300, 1500);
const controls = new OrbitControls(camera, renderer.domElement);

console.log(listAreas().map((a) => a.id)); // ['klcc', 'klec-midvalley']
const area = await loadArea('klcc');
const model = new MapModel(area, { palette: LIGHT_PALETTE });
model.setMode({ rails: { lrt: 'highlight', py: 'highlight' }, underground: true });
scene.add(model.group);

let last = 0;
renderer.setAnimationLoop((now) => {
  model.update(now, last ? (now - last) / 1000 : 0, { paused: document.hidden }); last = now;
  controls.update();
  renderer.render(scene, camera);
});
```

The whole thing is in [examples/basic/main.ts](examples/basic/main.ts). Need only the data (a 2D map, charts, a table)? Import `listAreas` / `loadArea` from `@map-assets/areas`; that module doesn't load Three.js.

**The main API**

| Export | What it is |
|---|---|
| `listAreas(kind?)` | the spot index: id, name, kind (`signature` or `site`), centre, bounds, stations, lines |
| `loadArea(id)` | one spot as an `Area` (loaded on demand, cached) |
| `Area` | `buildings`, `lines`, `areas`, `stations`, `routes`, `walks`, `landmarks`, `facilities`, `facts`, `meta`, `stats`, `zones`; `station(ref)`, `findPlace(name)`, `stationDistance(a, b)` |
| `climate` | cited monthly climate normals, shared by every spot |
| `LINE_COLORS`, `LINE_NUMBERS`, `publicCode(ref)` | official line colours, numbers, public stop numbers |
| `sunPosition(date, lat, lon)`, `mytDate(…)`, `solarNoon(…)` | sun position for shade studies |
| `MapModel(area, { palette })` | the 3D model: `group`, `setMode()`, `setPalette()`, `update()`, `shadeTest()`, `setTrains()`, `facilityAt` |
| `SceneMode`, `ModePatch`, `DEFAULT_MODE` | what the model shows (rails, footways, routes, building colouring, sun, x-ray, `underground`, `facilities`…) |
| `Palette`, `LIGHT_PALETTE`, `DARK_PALETTE` | colours and light levels; pass your own to match your site |
| `groundSamples(area)`, `routeSampleSets(area)` | sample points for sidewalk-shade analysis |

**Updating** to a newer release later: see [CONTRIBUTING.md § 6](CONTRIBUTING.md#6-update-a-website).

## Data and sources

- **OpenStreetMap** via the Overpass API, pulled per spot (`areas/<id>/data/meta.json`, `fetchedAt`): Mid Valley 2026-10-10, KLCC 2026-10-12. © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). Any site that shows the map must credit "© OpenStreetMap contributors".
- **Heights:** cited values from each spot's `sources/height-sources.json` (tables and limitations: [Mid Valley](areas/klec-midvalley/height-sources.md), [KLCC](areas/klcc/height-sources.md)). Otherwise the OSM `height` tag, or `building:levels` × 3.5 m. Anything else is a placeholder flagged as an estimate.
- **Facts** quoted in text (opening dates, park area…): `areas/<id>/sources/facts.json`, each with publisher and URL.
- **Rail:** line colours and station codes from Wikipedia (see `src/transit.ts`). Mid Valley: the Skypark route comes from OSM relations 9985660 / 8391024, and which KTM line uses each track from OSM route relations (`raw/ktm-routes.json`).
- **Underground depths** are schematic: 4.5 m per OSM `layer` step (OSM gives the order of levels, not depths).
- **Climate:** cited WMO 1991–2020 normals in `sources/climate.json`. Sun position uses the NOAA formulas.

## Known open items

**Mid Valley**

- **Tower of Light / Residensi Vogue 1 heights:** both use the CTBUH value of 243 m. For Tower of Light this conflicts with OSM `building:levels=31` (≈108.5 m), and IGB's 59-storey Southpoint may be the same tower. Vogue 1 has no OSM height. Needs checking on site.
- **Masjid Jamek car park:** modelled as 5 levels (OSM). 2016 press reports (FMT, Bernama) say a seven-level podium.
- **Mall heights** (5 × 5 m) are applied uniformly to untagged mall parts; named parts stay estimates.
- **KJ17** has no public stop number.

**KLCC**

- **Ombak KLCC** is tagged `building:levels=5` in OSM; the cited 6 retail levels are used (× 5 m, the study's mall storey).
- **Facilities** are only as complete as OSM: two KJ10 entrances and many car-park entrances carry no name or type.
- **Pedestrian links inside the malls and stations** (concourses, the KJ10–Suria subway) are only as complete as OSM's indoor mapping.

## Licence

No licence for the code yet: it is public to read, but all rights are reserved by the authors until a licence is chosen. The map data (`areas/*/data/`, `areas/*/raw/`) is © OpenStreetMap contributors and available under the [ODbL](https://opendatacommons.org/licenses/odbl/), as above.
