/* main roads 1/4 */
[out:json][timeout:300];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](3.03,101.605,3.14,101.6875);
out geom qt;

/* main roads 2/4 */
[out:json][timeout:300];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](3.03,101.6875,3.14,101.77);
out geom qt;

/* main roads 3/4 */
[out:json][timeout:300];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](3.14,101.605,3.25,101.6875);
out geom qt;

/* main roads 4/4 */
[out:json][timeout:300];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](3.14,101.6875,3.25,101.77);
out geom qt;

/* streets 1/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.03,101.605,3.10333,101.66);
out geom qt;

/* streets 2/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.03,101.66,3.10333,101.715);
out geom qt;

/* streets 3/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.03,101.715,3.10333,101.77);
out geom qt;

/* streets 4/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.10333,101.605,3.17667,101.66);
out geom qt;

/* streets 5/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.10333,101.66,3.17667,101.715);
out geom qt;

/* streets 6/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.10333,101.715,3.17667,101.77);
out geom qt;

/* streets 7/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.17667,101.605,3.25,101.66);
out geom qt;

/* streets 8/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.17667,101.66,3.25,101.715);
out geom qt;

/* streets 9/9 */
[out:json][timeout:300];
way["highway"~"^(residential|unclassified|living_street)$"](3.17667,101.715,3.25,101.77);
out geom qt;

/* water and green areas */
[out:json][timeout:300];
(
  way["natural"~"^(water|wetland|wood|scrub|grassland)$"](3.03,101.605,3.25,101.77);relation["natural"~"^(water|wetland|wood|scrub|grassland)$"](3.03,101.605,3.25,101.77);
  way["landuse"~"^(reservoir|basin|forest|grass|meadow|recreation_ground|cemetery|village_green)$"](3.03,101.605,3.25,101.77);relation["landuse"~"^(reservoir|basin|forest|grass|meadow|recreation_ground|cemetery|village_green)$"](3.03,101.605,3.25,101.77);
  way["waterway"~"^(riverbank)$"](3.03,101.605,3.25,101.77);relation["waterway"~"^(riverbank)$"](3.03,101.605,3.25,101.77);
  way["leisure"~"^(park|garden|golf_course|nature_reserve|recreation_ground)$"](3.03,101.605,3.25,101.77);relation["leisure"~"^(park|garden|golf_course|nature_reserve|recreation_ground)$"](3.03,101.605,3.25,101.77);
);
out geom qt;

/* place names */
[out:json][timeout:120];
node["place"~"^(town|suburb|quarter|neighbourhood)$"](3.03,101.605,3.25,101.77);
out qt;