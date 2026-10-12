# Contributing to map-assets

This is the workflow for changing the shared map, whatever editor or AI tool you use. AI tools: read [AGENTS.md](AGENTS.md) first. Setup is in [README.md](README.md#set-up).

## How a change travels

```
edit sources/ or pipeline/ or src/  →  npm run data:process  →  npm run data:check + typecheck
        →  branch + PR on map-assets  →  CI "Check" green  →  merge  →  tag vX.Y.Z
        →  each website moves its map-assets/ submodule to vX.Y.Z when it is ready
```

A merged change does **not** reach any website by itself. Websites pin a tag, so nothing breaks under them.

## 1. Branch

```bash
git switch main && git pull
git switch -c data/gardens-heights      # data/… for data and sources, model/… for code
```

## 2. Make the change

| You want to… | Edit | Notes |
|---|---|---|
| Add or correct a building height | `sources/height-sources.json` → `buildings[]` | One entry per OSM name: `osmName`, `value`, `unit` (`m` or `floors`), `floors`, `publisher`, `url`, `note`. Then add the row to [docs/height-sources.md](docs/height-sources.md). |
| Update climate normals | `sources/climate.json` | Keep `publisher`, `url`, `period`, `fetched`. |
| Change walking-route endpoints, precinct rules or landmark picks | `pipeline/process-osm.mjs` (`anchors`, `GARDENS_NAMES`, the landmark section) | These still live in code; read the comments next to them. |
| Fix wrong geometry, names or tags | OpenStreetMap itself ([openstreetmap.org](https://www.openstreetmap.org)) | Then re-pull: `npm run data:fetch && npm run data:process`. The diff of `raw/` is large; say so in the PR. |
| Change how the model looks or behaves | `src/model/*.ts` | No DOM access in `src/`; colours go through `Palette` (`src/model/palette.ts`). |
| Add a new kind of data | `pipeline/process-osm.mjs` → new file in `data/`, types and accessors in `src/data.ts`, export from `src/index.ts` | This is an API addition: minor version bump. |

Never edit `data/` by hand. CI regenerates it and fails the PR if it doesn't match.

## 3. Regenerate and check

```bash
npm run data:process     # rebuild data/
npm run data:check       # data/ is exactly what the pipeline makes (CI runs it too)
npm run typecheck
npm run example          # look at the model: http://127.0.0.1:5174/
```

Working from inside a website checkout (`<website>/map-assets/`)? The data commands need no `npm install` (the pipeline uses only Node), and the website's `npm run build` type-checks the model code. Don't run `npm install` there.

## 4. Commit and open a pull request

```bash
git add sources/ data/ docs/          # source change and regenerated data together
git commit -m "Heights: The Gardens towers from <publisher>"
git push -u origin data/gardens-heights
```

Open the PR on GitHub (or `gh pr create`). In the description, list the sources (publisher, URL, date fetched) and attach a screenshot from `npm run example` if the model looks different. CI runs the type check, `data:check` and the example build.

## 5. Release (maintainers, after merge)

Versions while 0.x:

- **Patch** (0.1.0 → 0.1.1): data fixes and new cited values; same API and data shape.
- **Minor** (0.1.x → 0.2.0): anything a website must adapt to: a renamed or removed export, a changed `SceneMode` / `Palette`, a changed JSON shape.

```bash
git switch main && git pull
# bump "version" in package.json and add a CHANGELOG.md entry, then:
git commit -am "Release v0.1.1"
git tag v0.1.1
git push && git push --tags
```

## 6. Update a website

In each website repo, when it is ready for the new map:

```bash
git -C map-assets fetch --tags
git -C map-assets checkout v0.1.1
npm run doctor && npm run build       # and the website's own checks
git add map-assets
git commit -m "map-assets v0.1.1"
git push
```

## Review checklist

- [ ] Every new or changed number has a source in `sources/` (or is flagged as an estimate).
- [ ] `data/` was regenerated, not hand-edited (`npm run data:check` passes in CI).
- [ ] `npm run typecheck` passes; `src/` has no DOM access.
- [ ] Breaking changes are called out in `CHANGELOG.md` with a minor version bump.
- [ ] OSM attribution is intact.
