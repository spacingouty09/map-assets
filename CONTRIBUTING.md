# Contributing to map-assets

This is the workflow for changing the shared map, whatever editor or AI tool you use. AI tools: read [AGENTS.md](AGENTS.md) first. Setup is in [README.md](README.md#set-up).

## How a change travels

```
edit areas/<id>/ (sources, rules) or pipeline/ or src/  →  npm run data:process  →  npm run data:check + typecheck
        →  branch + PR on map-assets  →  CI "Check" green  →  merge  →  tag vX.Y.Z
        →  each website moves its map-assets/ submodule to vX.Y.Z when it is ready
```

A merged change does **not** reach any website by itself. Websites pin a tag, so nothing breaks under them.

## 1. Branch

```bash
git switch main && git pull
git switch -c data/klcc-heights         # data/… for data and sources, area/… for a new spot, model/… for code
```

## 2. Make the change

| You want to… | Edit | Notes |
|---|---|---|
| Add or correct a building height | `areas/<id>/sources/height-sources.json` → `buildings[]` | One entry per OSM name: `osmName` (or `osmIds` and a `label` for a building unnamed in OSM), `value`, `unit` (`m` or `floors`), `floors`, `publisher`, `url`, `note` (`use: "mall"` for 5 m mall storeys; `applyToUntaggedParts` for a building drawn from parts). Then update that spot's `height-sources.md`. |
| Add or correct a fact quoted in text (opening date, park area…) | `areas/<id>/sources/facts.json` | Keep `publisher` and `url` on each entry and the top-level `fetched` date. |
| Correct OSM where it is behind (e.g. a building OSM still shows as under construction) | `areas/<id>/sources/overrides.json` | A cited override with `reason`, `publisher`, `url`, `fetched`. Better still, fix OSM itself. |
| Update climate normals | `sources/climate.json` (shared by all spots) | Keep `publisher`, `url`, `period`, `fetched`. |
| Change zones, landmarks, walking-route endpoints or pairs, rail lines or model hints | `areas/<id>/rules.json` | Each block has a `…Notes` field explaining it; keep them current. |
| Fix wrong geometry, names or tags | OpenStreetMap itself ([openstreetmap.org](https://www.openstreetmap.org)) | Then re-pull: `npm run data:fetch -- <id> && npm run data:process -- <id>`. The diff of `raw/` is large; say so in the PR. |
| Add a spot | a new `areas/<id>/` | See [Add a spot](#add-a-spot-the-pavilion-recipe) below. |
| Change how the model looks or behaves | `src/model/*.ts` | No DOM access in `src/`; colours go through `Palette` (`src/model/palette.ts`). |
| Add a new kind of data | `pipeline/process-osm.mjs` → new file in each spot's `data/`, types in `src/data.ts`, loader list in `writeIndex()` | This is an API addition: minor version bump. |

Never edit `data/` or the generated loaders by hand. CI regenerates them and fails the PR if they don't match.

## 3. Regenerate and check

```bash
npm run data:process     # rebuild every spot's data/ (or: npm run data:process -- klcc)
npm run data:check       # every generated file is exactly what the pipeline makes (CI runs it too)
npm run typecheck
npm run example          # look at the model: http://127.0.0.1:5174/?area=klcc
```

Working from inside a website checkout (`<website>/map-assets/`)? The data commands need no `npm install` (the pipeline uses only Node), and the website's `npm run build` type-checks the model code. Don't run `npm install` there.

## 4. Commit and open a pull request

```bash
git add areas/klcc/                  # source change and regenerated data together
git commit -m "KLCC heights: Menara PNB from <publisher>"
git push -u origin data/klcc-heights
```

No write access? Push to a fork instead (the GitHub CLI makes it and adds it as the `fork` remote), then open the pull request from it:

```bash
gh repo fork --remote --remote-name fork
git push -u fork data/klcc-heights
gh pr create --repo spacingouty09/map-assets   # or open the link that git push prints
```

Open the PR on GitHub (or `gh pr create`). In the description, list the sources (publisher, URL, date fetched) and attach a screenshot from `npm run example` if the model looks different. CI runs the type check, `data:check` and the example build. GitHub asks the spot's owner in [.github/CODEOWNERS](.github/CODEOWNERS) to review.

## Add a spot (the Pavilion recipe)

A spot is data and rules, no code. Use `areas/klcc/` as the worked example; every `…Notes` field in its `rules.json` explains a choice.

1. **Branch** `area/pavilion-bukit-bintang` and create `areas/pavilion-bukit-bintang/area.json`:

   ```json
   { "id": "pavilion-bukit-bintang", "name": "Pavilion – Bukit Bintang", "kind": "signature",
     "summary": "One sentence: what the spot covers and which stations serve it.",
     "center": { "lat": 0.0, "lon": 0.0 }, "halfSizeM": 600,
     "notes": "Why this centre and size (what must fit inside, with a margin)." }
   ```

   Replace the `0.0` centre with one read off OpenStreetMap, and say how you chose it in `notes`. `kind` is `signature` (a full spot, listed by `listAreas('signature')`) or `site` (one place for a single-site website).
2. **Pull OSM:** `npm run data:fetch -- pavilion-bukit-bintang` writes `raw/overpass.json` (buildings, roads, rail, footways, stations, facilities). Overpass rate-limits; the script retries on two mirrors (or set `OVERPASS_URL`).
3. **Write `rules.json`** (copy KLCC's and adapt):
   - `zones` (blocks coloured by landmark, by OSM building name) or `precincts` (by OSM landuse name), or `near` (`{ lat, lon, radiusM, types }`: blocks of those OSM building types within a radius, e.g. unnamed roof pieces of a stadium with no building outline), or `ids` (OSM ids such as `way/123`, for blocks unnamed in OSM; an outline brings its building:parts), `landmarks`, `partParents` (only when a building part lands in the wrong outline);
   - `anchors` (walking-route ends: a `station` ref, a `building` name, a `footway` name with its `end`, or a `point` `{ lat, lon }` with a `pointNote` when the place has no usable outline) and `routes` / `walks` (pairs of anchors). For Pavilion, reuse the KLCC walkway: an anchor on `"KLCC-Bukit Bintang Pedestrian Walkway"` at its northern end;
   - `railLines` (optional `[[regex, lineId], …]`, tried before the built-in list: e.g. `[["sri petaling", "lrt"]]` draws a line the built-in list doesn't know as the spot's `lrt`);
   - `railLengths` (line ids to measure: `lrt`, `ktm`, `erl`, `py`, `mr`), and `model` hints: `undergroundStops` for lines in tunnels, `lrtStop` / `ktm` for lines above ground, `parkPaths` for parks (by OSM name) whose paths belong on the base map in every view.
4. **Cite** heights in `sources/height-sources.json` (tall named towers, malls) and facts quoted in text in `sources/facts.json`; write `height-sources.md` (the KLCC one shows the format).
5. **Build and look:** `npm run data:process -- pavilion-bukit-bintang` prints counts (buildings, cited heights applied, facilities). Then `npm run data:process` once for all spots, `npm run data:check`, `npm run typecheck`, and `npm run example` → `?area=pavilion-bukit-bintang`. Check the zones, the routes and the cited heights on the model.
6. **Ownership:** add `/areas/pavilion-bukit-bintang/ @<your-github-name>` to [.github/CODEOWNERS](.github/CODEOWNERS).
7. **Pull request**, then a patch release (§ 5). A website shows the spot when it adds chapters for it (map-infographic: `src/spots/<spot>/`).

## 5. Release (maintainers, after merge)

Versions while 0.x:

- **Patch** (0.2.0 → 0.2.1): data fixes, new cited values, **a new spot**, docs and tooling; same API and data shape. A website that doesn't load the new spot is unaffected.
- **Minor** (0.2.x → 0.3.0): anything a website must adapt to: a renamed or removed export, a changed `SceneMode` / `Palette`, a changed JSON shape.

Replace `vX.Y.Z` with the new version. Use an annotated tag (`-a`): websites' `npm run doctor` and `git submodule status` show its name.

```bash
git switch main && git pull
# bump "version" in package.json (then npm install --package-lock-only) and add a CHANGELOG.md entry, then:
git commit -am "Release vX.Y.Z"
git tag -a vX.Y.Z -m "map-assets vX.Y.Z"
git push && git push origin vX.Y.Z
```

## 6. Update a website

In each website repo, when it is ready for the new map (replace `vX.Y.Z` with the release):

```bash
git -C map-assets fetch --tags
git -C map-assets checkout vX.Y.Z
npm run doctor && npm run build       # and the website's own checks
git add map-assets
git commit -m "map-assets vX.Y.Z"
git push
```

## Review checklist

- [ ] Every new or changed number has a source in the spot's `sources/` (or is flagged as an estimate).
- [ ] Generated files were regenerated, not hand-edited (`npm run data:check` passes in CI).
- [ ] Spot-specific choices live in `rules.json` with a note, not in `pipeline/` or `src/`.
- [ ] `npm run typecheck` passes; `src/` has no DOM access.
- [ ] Breaking changes are called out in `CHANGELOG.md` with a minor version bump.
- [ ] OSM attribution is intact.
