# Height sources

Fetched 2026-10-10. Applied by `pipeline/process-osm.mjs` from `sources/height-sources.json`; blocks get `heightSource: "cited"` and a `heightRef` object (value, unit, floors, storeyHeight, publisher, url, fetched, note).

Conversion: stated floors × 3.5 m (default) or × 5 m for mall retail floors. The 5.0 m mall storey is this study’s assumption (retail floors are typically taller than office/residential floors); no fetched source states the malls’ roof height in metres.

CTBUH values marked “CTBUH estimate” are estimates published by CTBUH from a floor count, not surveyed heights.

| OSM name | Value | Used height | Source | Note |
|---|---|---|---|---|
| Mercu 2 | 190.7 m (47 floors) | 190.7 m | [Wikipedia – List of tallest buildings in Kuala Lumpur (cites Emporis)](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Kuala_Lumpur) | Also known as Setia Tower. OSM height tag was 191 m. |
| Residensi Vogue 1 | 243 m (63 floors) | 243 m | [CTBUH Skyscraper Center – KL Eco City complex (Vogue Suite One)](https://www.skyscrapercenter.com/complex/5523) | Matched via Wikipedia KL Eco City master plan: 'Residensi Vogue 1 (Vogue Suites One)'. OSM has no height/levels. |
| MidValley Tower of Light | 243 m (56 floors) | 243 m | [CTBUH Skyscraper Center – MidValley Tower of Light](https://www.skyscrapercenter.com/building/midvalley-tower-of-light/29211) | CONFLICT: OSM building:levels=31 (≈108.5 m). CTBUH value applied by name match; verify on site. |
| Mercu Aspire | 211 m (48 floors) | 211 m · CTBUH estimate | [CTBUH Skyscraper Center – Aspire Tower](https://www.skyscrapercenter.com/building/aspire-tower/41681) | CTBUH estimate from 48 floors; SP Setia brochure states 42 storeys. |
| Menara TNB Bangsar | 189 m (43 floors) | 189 m · CTBUH estimate | [CTBUH Skyscraper Center – TNB Gold Tower](https://www.skyscrapercenter.com/building/tnb-gold-tower/1472) | CTBUH estimate from 43 floors. Outside the core cluster (south-west). |
| Strata Office | 154 m (35 floors) | 154 m · CTBUH estimate | [CTBUH Skyscraper Center – Strata Office Suites](https://www.skyscrapercenter.com/building/strata-office-suites/44727) | CTBUH estimate from 35 floors. |
| ViiA Residences | 184 m (47 floors) | 184 m | [Scraperbase – ViiA Residences & Amari Hotel](https://www.scraperbase.com/Malaysia/Kuala%20Lumpur/ViiA_Residences_and_Amari_Hotel) | Crowd-sourced database; lower confidence than CTBUH. |
| The Gardens North Tower | 32 floors | 112 m (32 × 3.5 m) | [StarProperty – The Gardens](http://www.starproperty.my/insight/509/the-gardens) | 'Office Tower: 32' storeys. Scraperbase lists 152 m (not used). |
| The Gardens South Tower | 32 floors | 112 m (32 × 3.5 m) | [StarProperty – The Gardens](http://www.starproperty.my/insight/509/the-gardens) | 'Office Tower: 32' storeys (each of the two towers). |
| St. Giles The Gardens Residences | 30 floors | 105 m (30 × 3.5 m) | [StarProperty – The Gardens](http://www.starproperty.my/insight/509/the-gardens) | 'The Gardens Residences: 30' storeys; matched by name (now operated as St. Giles). Same as OSM levels. |
| Menara IGB | 18 floors | 63 m (18 × 3.5 m) | [IGB Property Management – Menara IGB](https://igbproperty.com/menara-igb) | 'an 18-storey office building together with a 2-storey annexe'. OSM had building:levels=25. |
| Mercu 3 | 32 floors | 112 m (32 × 3.5 m) | [CBD Properties – Mercu 3, KL Eco City](https://cbd.my/estate_property/mercu-3-kl-eco-city/) | Agent listing: 'No. of Floors: 32'. Other listings say 31; Scraperbase 182 m/39 floors (not used). |
| The Gardens Mall | 5 floors | 25 m (5 × 5 m) | [StarProperty – The Gardens](http://www.starproperty.my/insight/509/the-gardens) | 'Retail Gallery: 5' storeys × 5.0 m mall storey (assumption). Applied to the mall outline's parts that had no OSM height/levels. |
| Mid Valley Megamall | 5 floors | 25 m (5 × 5 m) | [Wikipedia – Mid Valley Megamall (infobox)](https://en.wikipedia.org/wiki/Mid_Valley_Megamall) | 'floors = 5 (excluding car park)' × 5.0 m mall storey (assumption). Applied to parts with no OSM height/levels. |

## Found but not applied

- **Southpoint (IGB)** ([link](https://igbproperty.com/southpoint)): IGB: '59-storey mixed commercial building'. OSM has separate 'South Point' and 'MidValley Tower of Light' footprints; unclear which footprint is the tower, so not applied to avoid double counting.
- **The Gardens Hotel** ([link](http://www.starproperty.my/insight/509/the-gardens)): 27 storeys stated, but no OSM footprint is named for it.
- **Cititel, Boulevard, Northpoint, Centrepoint** ([link](https://igbproperty.com/)): No citable page fetched (IGB pages returned no building data).

## Everything else

All other blocks keep their OSM-derived height (`osm` height tag, `levels` × 3.5 m) or remain a flagged `estimate`. Nothing was guessed.

## Limitations

- Mall heights (5 floors × 5.0 m = 25 m) are applied uniformly to every unnamed OSM building part of the mall outline that had no height/levels tag. Named parts (e.g. Centrepoint North / South, Chili's) are left as estimates because no source covers them. Some of those parts may be car-park decks, annexes or atria with different real heights.
- Name matching relies on the OSM `name` tag equalling the source building. The MidValley Tower of Light match conflicts with OSM levels and should be checked.
