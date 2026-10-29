# Height sources: KL Sentral

Fetched 2026-10-29. Applied by `pipeline/process-osm.mjs` from `sources/height-sources.json` in this folder; blocks get `heightSource: "cited"` and a `heightRef` object (value, unit, floors, storeyHeight, publisher, url, fetched, note).

Matching: by OSM name (`osmName`), or by OSM id (`osmIds`) where the tower carries no name in OSM. The Hilton, Le Méridien and St. Regis towers are unnamed outlines in OSM; each was identified by the OSM hotel point that lies inside it.

Not cited here: The Sentral Residences (2 × 210.4 m, 58 floors, 2017, in `sources/facts.json`) is drawn from OSM building:parts, which keep their OSM heights (tallest part 210 m). Every other block uses its OSM height or levels.

| Building | Value | Used height | Source | Note |
|---|---|---|---|---|
| Q Sentral (`osmName`) | 205 m (48 floors) | 205 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Q Sentral Towers A and B (2014). OSM height tag 208 m, 49 levels. |
| CIMB Bank Building (`osmName`) | 162.3 m (40 floors) | 162.3 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Listed as "CIMB Headquarters" (2012). OSM has 41 levels and no height tag. |
| The St. Regis Kuala Lumpur (`osmIds` way/591510238, way/591510239, way/546288784) | 205 m (48 floors) | 205 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | 2016. Three overlapping unnamed OSM outlines (height tags 205, 207 and 205 m) beside the drop-off roof way/591508971 that holds the hotel point node/4619851015. |
| Hilton Kuala Lumpur (`osmIds` way/590933587) | 154 m (37 floors) | 154 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | 2004. The outline holds the hotel point node/995503922 (OSM 120 m, 30 levels); its two lower steps keep their OSM heights. |
| Le Méridien Kuala Lumpur (`osmIds` way/590933603) | 154 m (37 floors) | 154 m | [Wikipedia – List of tallest buildings in Kuala Lumpur](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | 2004. The outline holds the hotel point node/1635661887 (OSM 120 m, 30 levels); its two lower steps keep their OSM heights. |

Generated from `sources/height-sources.json`; edit the JSON, not this table.
