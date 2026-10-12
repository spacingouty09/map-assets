# Height sources: Bukit Jalil Sports City

Fetched 2026-10-12. Applied by `pipeline/process-osm.mjs` from `sources/height-sources.json` in this folder; blocks get `heightSource: "cited"` and a `heightRef` object (value, unit, floors, storeyHeight, publisher, url, fetched, note).

Conversion: stated floors × 3.5 m (default) or × 5 m for mall retail floors (this study’s assumption, as for Mid Valley and KLCC). No published metre heights were found for this spot.

Everything else is OSM `height` (317 blocks with `height` or `building:levels`) or an **estimate** by building type (`heightSource: "estimate"`). That includes the National Stadium (no building outline in OSM, the roof is ~300 unnamed `building=roof` pieces), Unifi Arena and the aquatic centre: no cited heights were found for them.

The three towers marked PLANNED are under construction (OSM `building=construction`); websites draw them as translucent "planned" ghost massing (`facts.json` → `planned`).

| OSM name | Value | Used height | Source | Note |
|---|---|---|---|---|
| Pavilion Bukit Jalil | 5 floors | 25 m (5 × 5 m) | [Wikipedia – Pavilion Bukit Jalil](https://en.wikipedia.org/wiki/Pavilion_Bukit_Jalil) | "Floors: 5 (mall), 2 (basement carpark)". OSM building:levels 4. |
| Hyatt Place | 14 floors | 49 m (14 × 3.5 m) | [EdgeProp – Hyatt Place Kuala Lumpur, Bukit Jalil to open by mid-2023 (29 Aug 2022)](https://www.edgeprop.my/content/1903498/hyatt-place-kuala-lumpur-bukit-jalil-open-mid-2023) | "a 14-storey block featuring a total of 250 hotel rooms". The architect (NRY) says 15 floors; the lower figure is used. |
| The Park Bukit Jalil | 46 floors | 161 m (46 × 3.5 m) | [PropertyGuru – Park Sky Residence, Bukit Jalil City review](https://www.propertyguru.com.my/bm/perumahan-baru/review/park-sky-residence-bukit-jalil-city-114319) | MATCH ASSUMED: OSM 'The Park Bukit Jalil' (way/765829731, Bukit Jalil City) taken to be Malton's The Park Sky Residence: towers A and D 40 storeys, B and C 46. OSM draws one outline, so it is drawn at the taller towers' count; verify. |
| The Link 2 | 36 floors | 126 m (36 × 3.5 m) | [PropertyGuru – Park Sky Residence review (comparison table: The Link2 Residences@BJ)](https://www.propertyguru.com.my/bm/perumahan-baru/review/park-sky-residence-bukit-jalil-city-114319) | "2 blocks, 32 and 36 storeys". One OSM outline (way/944352527); drawn at the taller block's count. |
| Park Green @ Bukit Jalil City (The Park 3) | 47 floors | 164.5 m (47 × 3.5 m) | [Park Green Pavilion Bukit Jalil (project site, Malton)](https://parkgreenpavilion.com.my/) | PLANNED / under construction (OSM building=construction). "47-story structure", two towers, 453 units. |
| The Vividz @ Bukit Jalil | 57 floors | 199.5 m (57 × 3.5 m) | [EXSIM new project page – The Vividz Bukit Jalil](https://newproject-exsim.com/thevividz/) | PLANNED / under construction (OSM building=construction). "Total Storeys: 57", two towers, est. completion 2029 Q2. |
| Veladaz Residences @ Bukit Jalil | 42 floors | 147 m (42 × 3.5 m) | [EXSIM new project page – Veladaz Residences](https://newproject-exsim.com/veladazresidences/) | PLANNED / under construction (OSM building=construction). "Total Storeys: 42", 508 units, est. completion 2027 Q3. |

Generated from `sources/height-sources.json`; edit the JSON, not this table.
