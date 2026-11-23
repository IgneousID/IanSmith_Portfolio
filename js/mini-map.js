// mini-map.js
// A small, slowly turning copy of the home page map for the case study pages.
// It marks the place this page belongs to, and clicking it goes back to the map.
//
// Use: <a class="mini-map" href="index.html#project-1" data-place="project-1"> ... </a>

import * as THREE from 'three';
import { createTerrain, CONFIG } from './terrain.js';
import { POINTS, layoutPoints, sitesFor } from './places.js';

const link = document.querySelector('.mini-map');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Phones get a gentler turn, since the map runs the full width of the screen there.
const small = window.matchMedia('(max-width: 799px)');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

if (link && webglAvailable()) {
  const current = link.dataset.place;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-hidden', 'true');
  link.prepend(renderer.domElement);
  link.classList.add('has-3d');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight('#ffffff', '#202020', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  // Same land the home page opens on, built at a lower detail so it's quick.
  layoutPoints(CONFIG.seed);
  const terrain = createTerrain({ ...CONFIG, resolution: 90 }, sitesFor());
  const world = new THREE.Group();
  world.position.y = -CONFIG.height * 0.45;
  scene.add(world);
  world.add(new THREE.Mesh(terrain.geometry, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  world.add(new THREE.LineSegments(terrain.lineGeometry, new THREE.LineBasicMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.7 })));

  // A pin over every place; this page's place gets a bigger, brighter one.
  const S = terrain.half;
  const pins = [];
  POINTS.forEach((p) => {
    const x = p.at[0] * S, z = p.at[1] * S;
    const y = terrain.topAt(x, z);
    const on = p.id === current;
    const h = on ? 1.6 : 0.8;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, h, 6).translate(0, h / 2, 0),
      new THREE.MeshBasicMaterial({ color: '#ff6b35', transparent: true, opacity: on ? 1 : 0.55 }),
    );
    stem.position.set(x, y, z);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(on ? 0.22 : 0.12),
      new THREE.MeshBasicMaterial({ color: '#ff6b35', transparent: true, opacity: on ? 1 : 0.55 }),
    );
    gem.position.y = h;
    stem.add(gem);
    world.add(stem);
    if (on) pins.push(gem);
  });

  const R = 34;
  let angle = Math.PI / 4;
  function place() {
    camera.position.set(Math.sin(angle) * R * 0.8, R * 0.62, Math.cos(angle) * R * 0.8);
    camera.lookAt(0, -0.4, 0);
  }
  function resize() {
    const w = link.clientWidth, h = link.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!reduced) {
      angle += dt * (small.matches ? 0.035 : 0.12);
      pins.forEach((g) => (g.rotation.y = now / (small.matches ? 3000 : 1500)));
    }
    place();
    renderer.render(scene, camera);
    if (!reduced) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
