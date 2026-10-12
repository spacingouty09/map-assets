# Height sources: KLCC

Fetched 2026-10-12. Applied by `pipeline/process-osm.mjs` from `sources/height-sources.json` in this folder; blocks get `heightSource: "cited"` and a `heightRef` object (value, unit, floors, storeyHeight, publisher, url, fetched, note).

Conversion: stated floors × 3.5 m (default) or × 5 m for mall retail floors (this study’s assumption, as for Mid Valley).

Where a building is drawn from OSM building parts (the Twin Towers, Menara Ilham, Menara Maxis), the parts keep their OSM heights and the cited figure is recorded on the building outline (`named-outlines.json`).

| OSM name | Value | Used height | Source | Note |
|---|---|---|---|---|
| Menara Berkembar Petronas | 451.9 m (88 floors) | 451.9 m · building parts keep their OSM heights | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Petronas Towers 1 and 2 (1998), each 451.9 m. Drawn from 25 OSM building:parts whose tallest tips are tagged 452 m. |
| Four Seasons Place Kuala Lumpur | 343 m (74 floors) | 343 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Four Seasons Place (2018). OSM height tag 342.5 m. |
| Menara Ilham | 274 m (58 floors) | 274 m · building parts keep their OSM heights | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Ilham Tower (2015). OSM height tag 274 m. Drawn as OSM building:parts; the cited value is recorded on the outline. |
| Menara 3 Petronas | 267 m (60 floors) | 267 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Petronas Tower 3 (2012). OSM height tag 267 m. |
| Equatorial Plaza | 229.7 m (55 floors) | 229.7 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Equatorial Plaza (2018). OSM height tag 230 m. |
| Menara Maxis | 212 m (49 floors) | 212 m · building parts keep their OSM heights | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Menara Maxis (1998). OSM height tag 150 m. Drawn as OSM building:parts; the cited value is recorded on the outline. |
| Menara AmBank | 210 m (50 floors) | 210 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | AmBank Tower (1998). OSM height tag 210 m. |
| Menara Citibank | 190.2 m (50 floors) | 190.2 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Citibank Tower (1995). OSM height tag 190 m. |
| Menara PNB | 171 m (45 floors) | 171 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Menara PNB (1985). OSM height tag 171 m. |
| Plaza Ombak KLCC | 6 floors | 30 m (6 × 5 m) | [Wikipedia – Ombak KLCC](https://en.wikipedia.org/wiki/Ombak_KLCC) | "6 retail levels, 3 basement levels" (opened 21 August 2026) × 5.0 m mall storey (assumption). OSM building:levels 5. |

Generated from `sources/height-sources.json`; edit the JSON, not this table.
