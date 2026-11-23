// The 3D model of a region (loadRegion): a light base map (motorways and trunk roads, rivers, the Federal Territory
// boundary; setBasemap lays the flat street map with water and green areas under it, tiles included), every rail line in its colour with lines that share a track drawn side by side, the stations, and the
// signature spots as small 3D tiles of their block massing at their real place. A journey (findJourney) can be drawn
// on top, with a marker riding along it. DOM-free like MapModel: a site adds `group` to its scene, owns the renderer
// and camera, and tells the model its drawing size (setResolution) and how far apart shared lines should sit
// (setLineSpacing, in metres, from its zoom).
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Area, XY } from '../data';
import { BASEMAP_ROAD_CLASSES, type Region, type RegionLine, type Journey, type RegionBasemap, type BasemapRoadClass } from '../region';
import { merge } from './geometry';
import { LIGHT_PALETTE, type Palette } from './palette';
import type { UpdateOptions } from './model';

export interface RegionMode {
  /** lines drawn in full; the others are drawn faint. null = every line in full */
  focusLines: string[] | null;
  /** a journey drawn on top (the rest of the network faint), or null */
  journey: Journey | null;
  /** a spot tile drawn as focused (the others plain), by area id, or null */
  focusSpot: string | null;
  /** station dots */
  stations: boolean;
}
export const DEFAULT_REGION_MODE: RegionMode = { focusLines: null, journey: null, focusSpot: null, stations: true };
export interface RegionModelOptions {
  palette?: Palette;
  /** the spots to draw as 3D tiles */
  areas?: Area[];
  /** line colours by line id (the site's own, e.g. cited official colours); default: the colour in the data (OSM) */
  lineColors?: Record<string, string>;
}

const SHARE_M = 40; // two lines closer than this, running the same way, share a track: drawn side by side
const STEP_M = 40; // resampling step for the side-by-side offsets
const Y = { fill: 0, street: 0.4, road: 0.6, river: 0.8, boundary: 1, line: 3, journey: 4 };
/** The flat street map (setBasemap): per road class its width (px; minor roads are 1 px lines), its strength (mix of
 *  ground towards the edge colour) and the zoom (m per px) up to which it is drawn in full, then fading out by `fade`. */
const STREET: Record<BasemapRoadClass, { w: number; k: number; full: number; fade: number }> = {
  motorway: { w: 2.4, k: 0.34, full: Infinity, fade: 0 }, trunk: { w: 2.1, k: 0.3, full: Infinity, fade: 0 },
  primary: { w: 1.7, k: 0.26, full: 40, fade: 30 }, secondary: { w: 1.4, k: 0.22, full: 16, fade: 16 },
  tertiary: { w: 1.15, k: 0.19, full: 8, fade: 10 }, minor: { w: 1, k: 0.16, full: 4, fade: 5 },
};
/** strength of the green and water areas (mix of ground towards the palette's green / water) */
const AREA_K = { green: 0.42, water: 0.5 };
const LINE_W = { full: 3.6, faint: 1.6, journey: 7, casing: 11 };

/** Round station dots of a constant size on screen (pixels, times the pixel ratio), with an outline. */
function dotMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ring: { value: new THREE.Color('#161616') }, ratio: { value: 1 }, opacity: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 fill; varying vec3 vFill; uniform float ratio;
      void main() { vFill = fill; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * ratio; }`,
    fragmentShader: `varying vec3 vFill; uniform vec3 ring; uniform float opacity;
      void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
        float edge = fwidth(r); float a = 1.0 - smoothstep(1.0 - edge, 1.0, r);
        vec3 c = mix(vFill, ring, smoothstep(0.62 - edge, 0.62, r)); gl_FragColor = vec4(c, a * opacity); }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
}

interface LineDraw { line: RegionLine; pts: XY[]; normals: XY[]; slots: number[]; obj: Line2; mat: LineMaterial; color: THREE.Color }

export class RegionModel {
  readonly group = new THREE.Group();
  readonly region: Region;
  mode: RegionMode = structuredClone(DEFAULT_REGION_MODE);
  palette: Palette;
  /** spot tiles by area id: their group (positioned at the area centre) and half size */
  readonly tiles = new Map<string, { group: THREE.Group; halfSizeM: number; center: THREE.Vector3 }>();

  private hemi = new THREE.HemisphereLight(0xffffff, 0xbdbdb8, 2.4);
  private sun = new THREE.DirectionalLight(0xffffff, 1.5);
  private lineColors: Record<string, string>;
  private draws: LineDraw[] = [];
  private spacing = 30;
  private resolution = new THREE.Vector2(1920, 1080);
  private mats = {
    ground: new THREE.MeshLambertMaterial(),
    road: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }), roadMajor: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }),
    river: new LineMaterial({ linewidth: 1.6, transparent: true, opacity: 0.85 }),
    boundary: new THREE.LineDashedMaterial({ dashSize: 260, gapSize: 180, transparent: true, opacity: 0.45 }),
    tile: new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    build: new THREE.MeshLambertMaterial(), buildFocus: new THREE.MeshLambertMaterial(),
    edge: new THREE.LineBasicMaterial({ transparent: true }), frame: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }),
    dots: dotMaterial(),
    casing: new LineMaterial({ linewidth: LINE_W.casing, transparent: true, depthTest: false }),
    marker: dotMaterial(),
  };
  private riverLines: Line2[] = [];
  private dots: THREE.Points;
  private dotStations: { id: string; lines: string[] }[] = [];
  private journeyGroup = new THREE.Group();
  private journeyLines: { obj: Line2; mat: LineMaterial; casing: Line2; cum: number[] }[] = [];
  private journeyPath: THREE.Vector3[] = []; private journeyCum: number[] = [];
  private journeyStart = 0;
  private marker: THREE.Points;
  private tileMeshes: { id: string; mesh: THREE.Mesh }[] = [];
  private baseRoads: THREE.Object3D[] = [];
  /** the plain plate under each spot tile: hidden while the flat street map is laid, which then shows under the buildings */
  private tilePlates: THREE.Object3D[] = [];
  private streets: { group: THREE.Group; roads: Partial<Record<BasemapRoadClass, { obj: THREE.Object3D; mat: LineMaterial | THREE.LineBasicMaterial }>>; green: THREE.MeshBasicMaterial; water: THREE.MeshBasicMaterial } | null = null;
  private mPerPx = 10;

  constructor(region: Region, opts: RegionModelOptions = {}) {
    this.region = region; this.palette = opts.palette ?? LIGHT_PALETTE;
    this.lineColors = Object.fromEntries(region.lines.map((l) => [l.id, opts.lineColors?.[l.id] ?? l.color]));
    this.group.add(this.hemi, this.sun, this.sun.target); this.sun.position.set(-4000, 9000, -3500);
    this.buildBase();
    this.buildLines();
    this.dots = this.buildStations();
    for (const a of opts.areas ?? []) this.buildTile(a);
    this.marker = new THREE.Points(new THREE.BufferGeometry(), this.mats.marker);
    this.marker.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.marker.geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array([15]), 1));
    this.marker.geometry.setAttribute('fill', new THREE.BufferAttribute(new Float32Array([1, 1, 1]), 3));
    this.marker.renderOrder = 12; this.marker.frustumCulled = false; this.marker.visible = false;
    this.journeyGroup.add(this.marker); this.group.add(this.journeyGroup);
    this.setPalette(this.palette);
    this.setMode({});
  }

  // ---------- frame helpers ----------
  /** a region point (x east, y north, m) as a scene position at height h */
  at(p: XY, h = 0) { return new THREE.Vector3(p[0], h, -p[1]); }
  /** a station's scene position (null for an unknown id or public code) */
  stationAt(idOrRef: string, h = 0) { const s = this.region.station(idOrRef) ?? this.region.stationByRef(idOrRef); return s ? this.at(s.c, h) : null; }

  // ---------- construction ----------
  private buildBase() {
    const { halfSizeM: [hx, hy], } = this.region.meta;
    // the ground and the flat map are drawn first, in order, without depth: flat layers this close together would flicker
    this.mats.ground.depthWrite = false;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(hx * 6, hy * 6), this.mats.ground); ground.rotation.x = -Math.PI / 2; ground.renderOrder = -10; this.group.add(ground);
    const segs = (cls: 'motorway' | 'trunk') => {
      const pos: number[] = [];
      for (const r of this.region.base.roads) if (r.cls === cls) for (let i = 1; i < r.pts.length; i++) pos.push(r.pts[i - 1][0], Y.road, -r.pts[i - 1][1], r.pts[i][0], Y.road, -r.pts[i][1]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
    };
    this.baseRoads = [new THREE.LineSegments(segs('trunk'), this.mats.road), new THREE.LineSegments(segs('motorway'), this.mats.roadMajor)];
    this.group.add(...this.baseRoads);
    for (const r of this.region.base.rivers) {
      const g = new LineGeometry(); g.setPositions(r.pts.flatMap((p) => [p[0], Y.river, -p[1]])); const l = new Line2(g, this.mats.river); this.riverLines.push(l); this.group.add(l);
    }
    for (const b of this.region.base.boundaries) for (const ring of b.rings) {
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map((p) => this.at(p, Y.boundary))), this.mats.boundary); l.computeLineDistances(); this.group.add(l);
    }
  }

  /** Lines resampled every STEP_M, with each point's side-by-side slot where lines share a track. */
  private buildLines() {
    const res = this.region.lines.map((line) => {
      const pts: XY[] = [];
      for (let i = 0; i < line.path.length; i++) {
        const p = line.path[i]; if (i === 0) { pts.push(p); continue; }
        const q = line.path[i - 1]; const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / STEP_M));
        for (let k = 1; k <= n; k++) pts.push([q[0] + (p[0] - q[0]) * k / n, q[1] + (p[1] - q[1]) * k / n]);
      }
      const tang = pts.map((_, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L] as XY; });
      return { line, pts, tang };
    });
    // grid of every resampled point, for the shared-track test
    const cell = 100; const grid = new Map<string, { li: number; i: number }[]>();
    res.forEach((r, li) => r.pts.forEach((p, i) => { const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`; let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push({ li, i }); }));
    res.forEach((r, li) => {
      const raw = r.pts.map((p, i) => {
        const near = new Map<number, number>(); // line -> its point index nearest p
        const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const h of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (h.li === li) continue; const q = res[h.li].pts[h.i]; const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d > SHARE_M) continue;
          const t = res[h.li].tang[h.i]; if (Math.abs(t[0] * r.tang[i][0] + t[1] * r.tang[i][1]) < 0.85) continue;
          const prev = near.get(h.li); if (prev == null || d < Math.hypot(res[h.li].pts[prev][0] - p[0], res[h.li].pts[prev][1] - p[1])) near.set(h.li, h.i);
        }
        if (!near.size) return 0;
        const set = [li, ...near.keys()].sort((a, b) => a - b); const ref = set[0];
        const refT = ref === li ? r.tang[i] : res[ref].tang[near.get(ref)!];
        const sign = refT[0] * r.tang[i][0] + refT[1] * r.tang[i][1] >= 0 ? 1 : -1;
        return (set.indexOf(li) - (set.length - 1) / 2) * sign;
      });
      // soften the steps where a shared stretch starts or ends
      const slots = raw.map((_, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const v = raw[i + k]; if (v != null) { s += v; n++; } } return s / n; });
      const normals = r.tang.map(([tx, ty]) => [-ty, tx] as XY); // left of the direction of travel
      const mat = new LineMaterial({ linewidth: LINE_W.full, transparent: true });
      const obj = new Line2(new LineGeometry(), mat); obj.renderOrder = 4;
      this.draws.push({ line: r.line, pts: r.pts, normals, slots, obj, mat, color: new THREE.Color(this.lineColors[r.line.id]) });
      this.group.add(obj);
    });
    this.placeLines();
  }
  private placeLines() {
    for (const d of this.draws) {
      const arr: number[] = [];
      d.pts.forEach((p, i) => { const o = d.slots[i] * this.spacing; arr.push(p[0] + d.normals[i][0] * o, Y.line, -(p[1] + d.normals[i][1] * o)); });
      d.obj.geometry.dispose(); const g = new LineGeometry(); g.setPositions(arr); d.obj.geometry = g; d.obj.computeLineDistances();
    }
  }
  /** Metres between lines that share a track (a site sets this from its zoom so they stay a few pixels apart). */
  setLineSpacing(m: number) { if (Math.abs(m - this.spacing) / this.spacing < 0.2) return; this.spacing = m; this.placeLines(); }
  get lineSpacing() { return this.spacing; }

  private buildStations() {
    const st = this.region.stations; this.dotStations = st.map((s) => ({ id: s.id, lines: s.lines }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(st.flatMap((s) => [s.c[0], Y.journey, -s.c[1]]), 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(st.map((s) => (s.lines.length > 1 ? 11 : 7.5)), 1));
    g.setAttribute('fill', new THREE.Float32BufferAttribute(st.flatMap(() => [1, 1, 1]), 3));
    const p = new THREE.Points(g, this.mats.dots); p.renderOrder = 10; p.frustumCulled = false; this.group.add(p);
    return p;
  }

  private buildTile(a: Area) {
    const [ox, oy] = this.region.areaOffset(a.info); const H = a.meta.halfSizeM;
    const group = new THREE.Group(); group.position.set(ox, 0, -oy);
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(2 * H, 2 * H), this.mats.tile); tile.rotation.x = -Math.PI / 2; tile.position.y = 1.5; group.add(tile);
    tile.visible = !this.streets; this.tilePlates.push(tile);
    const ex = a.buildings.filter((b) => b.ring.length >= 3 && Math.max(...b.ring.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) <= H).map((b) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(b.ring.map(([x, n]) => new THREE.Vector2(x, n))), { depth: Math.max(1, b.height - b.minHeight), bevelEnabled: false });
      g.rotateX(-Math.PI / 2); g.translate(0, 1.5 + b.minHeight, 0); return g;
    });
    const geo = merge(ex); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mats.build); group.add(mesh);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), this.mats.edge));
    const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-H, -H], [H, -H], [H, H], [-H, H]].map(([x, n]) => new THREE.Vector3(x, 2, -n))), this.mats.frame); group.add(frame);
    this.group.add(group);
    this.tiles.set(a.id, { group, halfSizeM: H, center: group.position.clone() });
    this.tileMeshes.push({ id: a.id, mesh });
  }

  // ---------- palette / mode ----------
  setPalette(p: Palette) {
    this.palette = p; const m = this.mats; const c = (s: string) => new THREE.Color(s || '#ff00ff');
    m.ground.color = c(p.ground); m.road.color = c(p.road); m.roadMajor.color = c(p.roadMajor); m.river.color = c(p.water);
    m.boundary.color = c(p.edge); m.tile.color = c(p.buildingContext); m.build.color = c(p.building); m.buildFocus.color = c(p.building);
    m.edge.color = c(p.edge); m.edge.opacity = p.edgeOpacity * 0.55; m.frame.color = c(p.edge);
    m.dots.uniforms.ring.value = c(p.edge); m.marker.uniforms.ring.value = c(p.edge); m.casing.color = c(p.building);
    const dark = c(p.ground).getHSL({ h: 0, s: 0, l: 0 }).l < 0.5; this.mats.boundary.opacity = dark ? 0.35 : 0.45;
    this.hemi.intensity = p.light.hemi; this.hemi.groundColor = c(p.light.hemiGround); this.sun.intensity = p.light.sun;
    const fill = this.dots.geometry.getAttribute('fill') as THREE.BufferAttribute; const f = c(p.building);
    for (let i = 0; i < fill.count; i++) fill.setXYZ(i, f.r, f.g, f.b); fill.needsUpdate = true;
    this.paintStreets();
    this.setMode({});
  }
  setMode(patch: Partial<RegionMode>) {
    const prevJourney = this.mode.journey; Object.assign(this.mode, patch); const md = this.mode;
    const focus = md.journey ? new Set<string>() : md.focusLines ? new Set(md.focusLines) : null;
    for (const d of this.draws) {
      const full = !focus || focus.has(d.line.id);
      d.mat.color = d.color; d.mat.linewidth = full ? LINE_W.full : LINE_W.faint; d.mat.opacity = full ? 1 : md.journey ? 0.28 : 0.35; d.obj.renderOrder = full ? 5 : 4;
    }
    // stations: dim the ones on faint lines
    const onFull = (s: { lines: string[] }) => !focus || s.lines.some((l) => focus.has(l));
    const size = this.dots.geometry.getAttribute('size') as THREE.BufferAttribute;
    this.dotStations.forEach((s, i) => size.setX(i, !md.stations ? 0 : onFull(s) ? (s.lines.length > 1 ? 11 : 7.5) : md.journey ? 0 : 5)); size.needsUpdate = true;
    for (const t of this.tileMeshes) t.mesh.material = md.focusSpot === t.id ? this.mats.buildFocus : this.mats.build;
    if (md.journey !== prevJourney) this.buildJourney();
  }

  /** the journey: per ride a casing and a line in the line's colour, drawn on over a few seconds, and a marker */
  private buildJourney() {
    for (const j of this.journeyLines) { j.obj.geometry.dispose(); j.casing.geometry.dispose(); j.mat.dispose(); this.journeyGroup.remove(j.obj, j.casing); }
    this.journeyLines = []; this.journeyPath = []; this.journeyCum = []; this.marker.visible = false;
    const j = this.mode.journey; if (!j) return;
    let acc = 0;
    for (const s of j.steps) {
      const pts = s.kind === 'ride' ? s.pts : [this.region.station(s.from)!.c, this.region.station(s.to)!.c];
      const arr = pts.flatMap((p) => [p[0], Y.journey, -p[1]]);
      const g = new LineGeometry(); g.setPositions(arr); const gc = new LineGeometry(); gc.setPositions(arr);
      const color = s.kind === 'ride' ? this.lineColors[s.line] : this.palette.edge;
      const mat = new LineMaterial({ linewidth: s.kind === 'ride' ? LINE_W.journey : 2.5, color: new THREE.Color(color).getHex(), transparent: true, depthTest: false, dashed: s.kind === 'walk', dashSize: 40, gapSize: 30 });
      mat.resolution.copy(this.resolution);
      const obj = new Line2(g, mat); obj.renderOrder = 9; if (s.kind === 'walk') obj.computeLineDistances();
      const casing = new Line2(gc, this.mats.casing); casing.renderOrder = 8; casing.visible = s.kind === 'ride';
      const cum = pts.map((p, i) => (acc += i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0));
      this.journeyGroup.add(casing, obj); this.journeyLines.push({ obj, mat, casing, cum });
      pts.forEach((p, i) => { const v = this.at(p, Y.journey); if (!this.journeyPath.length || this.journeyPath[this.journeyPath.length - 1].distanceTo(v) > 0.01) { this.journeyPath.push(v); this.journeyCum.push(cum[i]); } });
    }
    const f = new THREE.Color(this.palette.building); this.marker.geometry.getAttribute('fill').setXYZ(0, f.r, f.g, f.b); this.marker.geometry.getAttribute('fill').needsUpdate = true;
    this.journeyStart = -1; // set on the next update
  }
  /** Draw the journey on again from the start (and ride the marker along it). */
  replayJourney() { this.journeyStart = -1; }
  /** Every scene point of the current journey, in order (for framing it), or []. */
  get journeyPoints() { return this.journeyPath; }

  // ---------- flat street map ----------
  /** Lay the region's flat street map (loadRegionBasemap) under the network: green and water areas, then the roads
   *  by class (thinner classes fade out as the view zooms out, see setScale). Replaces the motorways and trunk roads of
   *  the region data, and the spot tiles lose their plain plate so the same streets, water and green run on under their
   *  buildings, inside the tile's frame. Call again to replace it. */
  setBasemap(b: RegionBasemap) {
    this.clearBasemap();
    const group = new THREE.Group(); group.name = 'basemap';
    const area = (polys: number[][][], order: number) => {
      const pos: number[] = []; const idx: number[] = [];
      for (const poly of polys) {
        const rings = poly.map((r) => { const v: THREE.Vector2[] = []; for (let i = 0; i + 1 < r.length; i += 2) v.push(new THREE.Vector2(r[i], r[i + 1])); return v; });
        const tris = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1)); // drops a repeated closing point in place
        const base = pos.length / 3; for (const ring of rings) for (const p of ring) pos.push(p.x, Y.fill, -p.y);
        for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = order; group.add(mesh); return mat;
    };
    const green = area(b.green, -9), water = area(b.water, -8);
    const roads: NonNullable<RegionModel['streets']>['roads'] = {};
    for (const cls of [...BASEMAP_ROAD_CLASSES].reverse()) { // thin first, so wider roads draw over them
      const pos: number[] = [];
      for (const line of b.roads[cls] ?? []) for (let i = 2; i + 1 < line.length; i += 2) pos.push(line[i - 2], Y.street, -line[i - 1], line[i], Y.street, -line[i + 1]);
      if (!pos.length) continue;
      if (cls === 'minor') {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mat = new THREE.LineBasicMaterial({ depthWrite: false }); const obj = new THREE.LineSegments(g, mat); obj.renderOrder = -7; group.add(obj); roads[cls] = { obj, mat };
      } else {
        const g = new LineSegmentsGeometry(); g.setPositions(pos);
        const mat = new LineMaterial({ linewidth: STREET[cls].w, depthWrite: false }); mat.resolution.copy(this.resolution);
        const obj = new LineSegments2(g, mat); obj.renderOrder = -7 + (BASEMAP_ROAD_CLASSES.length - BASEMAP_ROAD_CLASSES.indexOf(cls)) * 0.1; group.add(obj); roads[cls] = { obj, mat };
      }
    }
    for (const o of [...this.baseRoads, ...this.tilePlates]) o.visible = false;
    this.streets = { group, roads, green, water }; this.group.add(group);
    this.paintStreets();
  }
  /** Remove the flat street map (the region's motorways and trunk roads, and the tiles' plates, come back). */
  clearBasemap() {
    if (!this.streets) return;
    this.group.remove(this.streets.group);
    this.streets.group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    this.streets = null; for (const o of [...this.baseRoads, ...this.tilePlates]) o.visible = true;
  }
  /** The view's scale in metres per CSS pixel (at the orbit target): the thinner road classes fade out as it grows. */
  setScale(mPerPx: number) {
    if (Math.abs(mPerPx - this.mPerPx) / this.mPerPx < 0.02) return;
    this.mPerPx = mPerPx; this.paintStreets();
  }
  private paintStreets() {
    const st = this.streets; if (!st) return;
    const p = this.palette; const ground = new THREE.Color(p.ground);
    st.green.color.copy(ground).lerp(new THREE.Color(p.green), AREA_K.green);
    st.water.color.copy(ground).lerp(new THREE.Color(p.water), AREA_K.water);
    for (const cls of BASEMAP_ROAD_CLASSES) {
      const r = st.roads[cls]; if (!r) continue; const s = STREET[cls];
      const fade = this.mPerPx <= s.full ? 1 : Math.max(0, 1 - (this.mPerPx - s.full) / s.fade);
      r.obj.visible = fade > 0.02;
      r.mat.color.copy(ground).lerp(new THREE.Color(p.edge), s.k * fade);
    }
  }

  /** The drawing size in CSS pixels and the device pixel ratio (fat lines and dots are sized in pixels). */
  setResolution(w: number, h: number, pixelRatio = 1) {
    this.resolution.set(w, h);
    const streetMats = Object.values(this.streets?.roads ?? {}).map((r) => r.mat).filter((m): m is LineMaterial => m instanceof LineMaterial);
    for (const m of [...this.draws.map((d) => d.mat), this.mats.river, this.mats.casing, ...this.journeyLines.map((j) => j.mat), ...streetMats]) m.resolution.set(w, h);
    this.mats.dots.uniforms.ratio.value = pixelRatio; this.mats.marker.uniforms.ratio.value = pixelRatio;
  }
  /** Which spot tile (area id) a ray hits, or null (for clicks on the map). */
  pickTile(ray: THREE.Raycaster): string | null {
    const hit = ray.intersectObjects(this.tileMeshes.map((t) => t.mesh), false)[0]; return hit ? this.tileMeshes.find((t) => t.mesh === hit.object)!.id : null;
  }

  // ---------- per frame ----------
  /** Draw on the journey and move its marker. `now` in ms, `dt` in seconds. */
  update(now: number, _dt: number, opts: UpdateOptions = {}) {
    if (!this.journeyLines.length) return;
    if (this.journeyStart < 0) this.journeyStart = now;
    const total = this.journeyCum[this.journeyCum.length - 1] || 1;
    const dur = Math.min(9000, Math.max(3000, total / 2.4)); // ~2.4 km/s on screen: illustrative, not a train speed
    const k = opts.reducedMotion ? 1 : Math.min(1, (now - this.journeyStart) / dur); const d = k * total;
    for (const j of this.journeyLines) {
      const n = j.cum.length - 1; const g = j.obj.geometry as LineGeometry; const gc = j.casing.geometry as LineGeometry;
      g.instanceCount = gc.instanceCount = opts.reducedMotion ? n : j.cum.filter((c, i) => i > 0 && c <= d + 1e-6).length;
    }
    let i = this.journeyCum.findIndex((c) => c >= d); if (i <= 0) i = 1;
    const t = (d - this.journeyCum[i - 1]) / Math.max(1e-6, this.journeyCum[i] - this.journeyCum[i - 1]);
    (this.marker.geometry.getAttribute('position') as THREE.BufferAttribute).copyArray(new THREE.Vector3().lerpVectors(this.journeyPath[i - 1], this.journeyPath[i], THREE.MathUtils.clamp(t, 0, 1)).toArray());
    this.marker.geometry.getAttribute('position').needsUpdate = true; this.marker.visible = true;
  }
}
