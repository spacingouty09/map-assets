# map-assets

The shared map of the rail-and-mall cluster on both banks of the Klang River in Kuala Lumpur: KL Eco City, The Gardens Mall and Mid Valley Megamall, around Abdullah Hukum (LRT Kelana Jaya Line and KTM) and Mid Valley KTM. A 1 km × 1 km study area.

It holds:

- **Data:** 322 building blocks with heights, roads, rail, footways and footbridges, walking routes, stations, landmarks and climate normals.
- **The pipeline** that builds the data from OpenStreetMap.
- **The cited sources** for every number that doesn't come from OSM.
- **A Three.js model** of all of it, ready to drop into any website.

Websites include this repo as a **git submodule**. The first one is [map-infographic](https://github.com/spacingouty09/map-infographic). Split out of [noowxela/klec-midvalley-infographic](https://github.com/noowxela/klec-midvalley-infographic) at `f26ec5c` with its history; the massing is illustrative, not a survey.

- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (workflow, release, updating websites)
- **AI tools** (Cursor, Grok, Claude Code…): [AGENTS.md](AGENTS.md)
- **Changes:** [CHANGELOG.md](CHANGELOG.md)

## What's here

```
data/         generated JSON: buildings, lines (roads, rail, footways, water), areas, stations,
              routes, landmarks, named outlines, meta. Never edit by hand.
sources/      hand-curated, cited inputs: height-sources.json, climate.json
raw/          the OpenStreetMap pull (Overpass) and KTM route relations
pipeline/     config.mjs (study area), fetch-osm.mjs (raw/), process-osm.mjs (raw/ + sources/ → data/)
src/
  index.ts    public API (everything below)
  data.ts     types, typed accessors (buildings, routes, station(), findPlace(), stats, climate…)
  transit.ts  official line colours, line numbers, public stop numbers
  sun.ts      sun position (NOAA formulas), Malaysia time helpers
  model/      MapModel (the Three.js model), trains, shade sampling, geometry helpers, palettes
examples/basic/   the smallest website using the model
docs/height-sources.md   every cited height, its source and caveats
```

Coordinates are metres in a local frame: `x` east and `y` north of the study-area centre (`meta.center`). In Three.js, `y` is up and `z = -north`.

## Set up

You need Node 22+ and access to this private repo (ask for an invite). If `git clone` asks for a password, run `gh auth login` (GitHub CLI) once, or use a personal access token.

```bash
git clone https://github.com/spacingouty09/map-assets.git
cd map-assets
npm ci
npm run typecheck
npm run example        # http://127.0.0.1:5174/ : the model on its own
```

To change data or the model, follow [CONTRIBUTING.md](CONTRIBUTING.md).

| Command | What it does |
|---|---|
| `npm run typecheck` | strict TypeScript check |
| `npm run data:process` | rebuild `data/` from `raw/` + `sources/` |
| `npm run data:check` | rebuild and fail if `data/` changed (CI) |
| `npm run data:fetch` | re-pull OpenStreetMap into `raw/` |
| `npm run example` / `example:build` | run / build `examples/basic` |

## Use it in a website

Any Vite + TypeScript site works. The steps below are the setup [map-infographic](https://github.com/spacingouty09/map-infographic) uses.

**1. Add the submodule and pin a release:**

```bash
git submodule add https://github.com/spacingouty09/map-assets.git map-assets
git -C map-assets checkout v0.1.0
npm install three@0.186.1 && npm install -D @types/three@0.186.0
git add .gitmodules map-assets package.json package-lock.json
git commit -m "Add map-assets v0.1.0"
```

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
  build: { chunkSizeWarningLimit: 1200 }, // the map data is bundled
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

**3. Render it.** The model brings its own lights and everything in the study area. Your site owns the renderer, camera and UI:

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapModel, LIGHT_PALETTE } from '@map-assets';

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

const model = new MapModel({ palette: LIGHT_PALETTE });
model.setMode({ rails: { lrt: 'highlight', ktm: 'highlight', erl: 'context' }, routeSet: 'walks' });
scene.add(model.group);

let last = 0;
renderer.setAnimationLoop((now) => {
  model.update(now, last ? (now - last) / 1000 : 0, { paused: document.hidden }); last = now;
  controls.update();
  renderer.render(scene, camera);
});
```

The whole thing is in [examples/basic/main.ts](examples/basic/main.ts). Need only the data (a 2D map, charts, a table)? Import from `@map-assets/data`; that module doesn't load Three.js.

**The main API**

| Export | What it is |
|---|---|
| `buildings`, `lines`, `areas`, `routes`, `walks`, `stations`, `landmarks`, `meta`, `climate` | the data, typed |
| `station(ref)`, `findPlace(name)`, `stats` | lookups and derived figures |
| `LINE_COLORS`, `LINE_NUMBERS`, `publicCode(ref)` | official line colours, numbers, public stop numbers |
| `sunPosition(date, lat, lon)`, `mytDate(…)`, `solarNoon(…)` | sun position for shade studies |
| `MapModel` | the 3D model: `group`, `setMode()`, `setPalette()`, `update()`, `shadeTest()`, `setTrains()` |
| `SceneMode`, `DEFAULT_MODE` | what the model shows (rails, footways, routes, building colouring, sun, x-ray…) |
| `Palette`, `LIGHT_PALETTE`, `DARK_PALETTE` | colours and light levels; pass your own to match your site |
| `groundSamples`, `routeSampleSets` | sample points for sidewalk-shade analysis |

**Updating** to a newer release later: see [CONTRIBUTING.md § 6](CONTRIBUTING.md#6-update-a-website).

## Data and sources

- **OpenStreetMap** via the Overpass API, pulled 2026-10-10 (`data/meta.json`, `fetchedAt`). © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). Any site that shows the map must credit "© OpenStreetMap contributors".
- **Heights:** cited values from `sources/height-sources.json` (table and limitations in [docs/height-sources.md](docs/height-sources.md)). Otherwise the OSM `height` tag, or `building:levels` × 3.5 m. Anything else is a placeholder flagged as an estimate.
- **Rail:** line colours and station codes from Wikipedia (see `src/transit.ts`). The Skypark route comes from OSM relations 9985660 / 8391024. Which KTM line uses each track comes from OSM route relations (`raw/ktm-routes.json`).
- **Climate:** cited WMO 1991–2020 normals in `sources/climate.json`. Sun position uses the NOAA formulas.

## Known open items

- **Tower of Light / Residensi Vogue 1 heights:** both use the CTBUH value of 243 m. For Tower of Light this conflicts with OSM `building:levels=31` (≈108.5 m), and IGB's 59-storey Southpoint may be the same tower. Vogue 1 has no OSM height. Needs checking on site.
- **Masjid Jamek car park:** modelled as 5 levels (OSM). 2016 press reports (FMT, Bernama) say a seven-level podium.
- **Mall heights** (5 × 5 m) are applied uniformly to untagged mall parts; named parts stay estimates.
- **KL Eco City underground roads** are in `data/lines.json` (`tunnel` / negative `layer`) but the model doesn't draw them.
- **KJ17** has no public stop number.
- Route endpoints, precinct rules and landmark picks live in `pipeline/process-osm.mjs`; moving them to `sources/` would make them easier to edit.

## Licence

No licence yet: all rights reserved by the authors. The map data stays under the ODbL as above.
