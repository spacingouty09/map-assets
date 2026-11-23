[out:json][timeout:300];
relation["type"="route"]["route"~"^(train|subway|light_rail|monorail)$"](2.88,101.38,3.33,101.82)->.r;
.r out body;
way(r.r)->.w;
.w out geom;
node(r.r)->.n;
.n out body;
(
  node["railway"~"^(station|halt)$"](2.88,101.38,3.33,101.82);
  node["public_transport"="station"]["railway"](2.88,101.38,3.33,101.82);
);
out body;
way["highway"~"^(motorway|trunk)$"](2.88,101.38,3.33,101.82);
out geom;
way["waterway"="river"](2.88,101.38,3.33,101.82);
out geom;
relation["boundary"="administrative"]["admin_level"="4"]["name"~"Kuala Lumpur|Putrajaya"](2.88,101.38,3.33,101.82);
out geom;