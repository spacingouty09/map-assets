// The smallest site that uses map-assets: a renderer, a camera with orbit controls, and one area's model.
// Pick the area with ?area=<id> (or the picker); in a website the import is '@map-assets' (see README.md).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapModel, LIGHT_PALETTE, DARK_PALETTE, listAreas, loadArea, clipPlanes } from '../../src';

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const areas = listAreas();
const areaId = new URLSearchParams(location.search).get('area') ?? areas[0].id;

// area picker (each area is its own data chunk, loaded on demand)
const picker = document.createElement('select');
picker.id = 'area'; picker.setAttribute('aria-label', 'Area');
for (const a of areas) picker.append(new Option(a.name, a.id, false, a.id === areaId));
picker.addEventListener('change', () => { location.search = `?area=${encodeURIComponent(picker.value)}`; });
document.body.append(picker);

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.localClippingEnabled = true; // trains are clipped at the study-area edge
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(dark ? '#121212' : '#f3f3f1');
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 20, 9000);
camera.position.set(1100, 1300, 1500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

void loadArea(areaId).then((area) => {
  const clip = clipPlanes(area.meta.halfSizeM);
  camera.near = clip.near; camera.far = clip.far; camera.updateProjectionMatrix();
  controls.maxDistance = Math.max(6000, area.meta.halfSizeM * 4);
  const model = new MapModel(area, { palette: dark ? DARK_PALETTE : LIGHT_PALETTE });
  model.setMode({ rails: { lrt: 'highlight', ktm: 'highlight', erl: 'context' }, footways: 'faint', routeSet: 'walks' });
  scene.add(model.group);
  (window as unknown as { model: MapModel }).model = model; // for poking at it from the console
  let last = 0;
  renderer.setAnimationLoop((now) => {
    const dt = last ? (now - last) / 1000 : 0; last = now;
    model.update(now, dt, { reducedMotion: reducedMotion(), paused: document.hidden });
    controls.update();
    const dist = Math.max(1, camera.position.distanceTo(controls.target));
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * dist;
    model.setScreenDensity((innerHeight * 0.5) / halfH);
    if (model.fitShadows(camera, controls.target)) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  });
});
