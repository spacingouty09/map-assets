// The smallest site that uses map-assets: a renderer, a camera with orbit controls, and the model.
// In a website the import is '@map-assets' (see README.md, "Use it in a website").
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapModel, LIGHT_PALETTE, DARK_PALETTE } from '../../src';

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true; // trains are clipped at the study-area edge
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(dark ? '#121212' : '#f3f3f1');
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 20, 9000);
camera.position.set(1100, 1300, 1500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const model = new MapModel({ palette: dark ? DARK_PALETTE : LIGHT_PALETTE });
model.setMode({ rails: { lrt: 'highlight', ktm: 'highlight', erl: 'context' }, footways: 'faint', routeSet: 'walks' });
scene.add(model.group);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
let last = 0;
renderer.setAnimationLoop((now) => {
  const dt = last ? (now - last) / 1000 : 0; last = now;
  model.update(now, dt, { reducedMotion: reducedMotion(), paused: document.hidden });
  controls.update();
  renderer.render(scene, camera);
});
