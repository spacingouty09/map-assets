// Colours and light levels of the 3D model. Colours are CSS colour strings (hex), parsed with THREE.Color.
// A site can pass one of the built-in palettes or build its own (the infographic reads its CSS variables).
import type { HeightSource, Zone } from '../data';
import { LINE_COLORS } from '../transit';

export interface Palette {
  ground: string; road: string; roadMajor: string;
  water: string; waterMuted: string; green: string;
  /** key blocks (named precincts, stations, >= 45 m) and the rest */
  building: string; buildingContext: string;
  edge: string; edgeOpacity: number; edgeContextOpacity: number;
  heightSource: Record<HeightSource, string>;
  zone: Record<Zone, string>;
  rail: { lrt: string; ktm1: string; ktm2: string; erl: string; kliaTransit: string; skypark: string };
  footway: string; footbridge: string;
  route: string; covered: string; open: string;
  /** shade sample dots: in sun / in shade */
  sunlit: string; shaded: string;
  landmark: string; podium: string;
  train: { body: string; window: string; accent: string };
  light: { hemi: number; hemiGround: string; sun: number };
}

const rail = { lrt: LINE_COLORS.lrt, ktm1: LINE_COLORS.ktm1, ktm2: LINE_COLORS.ktm2, kliaTransit: LINE_COLORS.kliaTransit, skypark: LINE_COLORS.skypark };

/** The infographic's light theme. */
export const LIGHT_PALETTE: Palette = {
  ground: '#efefec', road: '#dcdcd8', roadMajor: '#cfcfca',
  water: '#7fb3b8', waterMuted: '#dfe3e3', green: '#b7c9a4',
  building: '#ffffff', buildingContext: '#ecece8',
  edge: '#161616', edgeOpacity: 0.55, edgeContextOpacity: 0.22,
  heightSource: { osm: '#3a3a38', levels: '#9a9a96', estimate: '#e9e9e5', cited: '#6a4fc0' },
  zone: { eco: '#d49a92', gardens: '#d6bf8c', midvalley: '#9aa6bd' },
  rail: { ...rail, erl: '#8d8d8a' },
  footway: '#8d8d8a', footbridge: '#161616',
  route: '#e2552f', covered: '#1b7fa6', open: '#8e8e88',
  sunlit: '#e0a020', shaded: '#3c5a78',
  landmark: '#4a4743', podium: '#d3cdc0',
  train: { body: '#f4f3ef', window: '#7d8791', accent: LINE_COLORS.lrt },
  light: { hemi: 2.4, hemiGround: '#bdbdb8', sun: 1.5 },
};

/** The infographic's dark theme. */
export const DARK_PALETTE: Palette = {
  ground: '#171717', road: '#242423', roadMajor: '#2c2c2a',
  water: '#3f6f74', waterMuted: '#22292a', green: '#3f4f36',
  building: '#3a3a38', buildingContext: '#262625',
  edge: '#f0f0ec', edgeOpacity: 0.5, edgeContextOpacity: 0.16,
  heightSource: { osm: '#f0f0ec', levels: '#8a8a85', estimate: '#2e2e2c', cited: '#a68cf5' },
  zone: { eco: '#a86e67', gardens: '#a08a58', midvalley: '#6b7891' },
  rail: { ...rail, erl: '#77776f' },
  footway: '#85857f', footbridge: '#ededea',
  route: '#ff7a4d', covered: '#4cc3e0', open: '#77776f',
  sunlit: '#f0b43a', shaded: '#4f78a6',
  landmark: '#e6e0cf', podium: '#57534b',
  train: { body: '#a9a8a2', window: '#3b4048', accent: LINE_COLORS.lrt },
  light: { hemi: 1.6, hemiGround: '#202020', sun: 1.1 },
};
