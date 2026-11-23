# Height sources: KLIA

Fetched 2026-11-23. Applied by `pipeline/process-osm.mjs` from `sources/height-sources.json` in this folder; blocks get `heightSource: "cited"` and a `heightRef` object (value, unit, floors, storeyHeight, publisher, url, fetched, note).

No cited heights yet. No published metre heights were found for the terminals, gateway@klia2, Mitsui Outlet Park or the circuit buildings.

The two control towers keep their OSM heights: KUL ATC Tower East (way/866700357, OSM height 119 m on the outline) and KUL ATC Tower West are mapped as stacked `building:part`s reaching 130 m and 133.8 m. KUL Apron Tower has an OSM height of 11.8 m on its outline, with parts up to 55 m.

Everything else is OSM `height` or `building:levels` × 3.5 m (61 blocks), or an **estimate** by building type (`heightSource: "estimate"`, about 1,185 blocks). The terminals come out low: Terminal 1 (Main Building) has `building:levels=1` in OSM (3.5 m) and the Satellite Building has no levels (7 m estimate). Their real heights are an open item.

| OSM name | Value | Used height | Source | Note |
|---|---|---|---|---|
