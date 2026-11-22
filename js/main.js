// main.js
// Sets up the 3D scene: terrain, trees, points of interest, paths,
// camera controls (mouse, touch and keyboard) and the section panel.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createTerrain, CONFIG, mulberry32 } from './terrain.js';
import { planTrail } from './trails.js';
import { STARS, CONSTELLATION_LINES } from './sky-data.js';
import { POINTS, EXTRA_SECTIONS, TRAILS, layoutPoints, sitesFor } from './places.js';


const ACCENT = new THREE.Color('#ff6b35');
const BG = new THREE.Color('#141414');

const root = document.documentElement;
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

if (webglAvailable()) {
  init();
} else {
  root.classList.add('no-webgl');
}

function init() {
  root.classList.add('map-mode');

  const container = document.getElementById('scene');
  const labelLayer = document.getElementById('labels');
  const panel = document.getElementById('panel');
  const panelClose = document.getElementById('panel-close');
  const live = document.getElementById('live');
  const legend = document.getElementById('legend');
  const legendToggle = document.getElementById('legend-toggle');
  const status = document.getElementById('status');
  const articles = [...panel.querySelectorAll('article[data-section]')];
  const navLinks = [...document.querySelectorAll('#section-nav a[href^="#"]')];

  panel.hidden = true;

  // The name in the corner always returns to the map overview.
  document.getElementById('home-link').addEventListener('click', (e) => {
    e.preventDefault();
    backToMap();
  });
  articles.forEach((a) => (a.hidden = true));

  // ----- renderer, scene, camera -----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG);
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 10, 40);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);

  const hemi = new THREE.HemisphereLight('#ffffff', '#202020', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  // ----- world -----
  // Everything on the map lives in `content`, which build() throws away and
  // rebuilds when the terrain is regenerated. The landmarks (POINTS) stay put;
  // only the land around them changes.
  const world = new THREE.Group();
  world.position.y = -CONFIG.height * 0.45;
  scene.add(world);
  const S = CONFIG.size / 2;

  // Shared pieces reused across rebuilds.
  const whiteMat = new THREE.MeshLambertMaterial({ color: '#f4f4f4', emissive: '#555555' });
  const terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const lineMat = new THREE.LineBasicMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.85 });
  // Soft glowing dots for lit windows and campfires at night.
  const glowTexture = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,230,170,1)');
    grad.addColorStop(0.25, 'rgba(255,190,110,0.55)');
    grad.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const fireMat = glowMat.clone();   // campfire and lantern: flickers
  const haloMat = glowMat.clone();   // wide, faint pool of light around camp and tent
  const addGlow = (x, y, z, size = 0.28, mat = glowMat) => {
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    content.add(sp);
  };
  const accentMat = new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide });
  const treeGeo = new THREE.ConeGeometry(0.055, 0.22, 6).translate(0, 0.11, 0);
  // A small library of low-poly trees, each built from simple shapes.
  const trunk = (h, r = 0.008) => new THREE.CylinderGeometry(r * 0.8, r, h, 5).translate(0, h / 2, 0);
  const TREE_GEOS = {
    pine: treeGeo,
    spruce: mergeGeometries([
      trunk(0.04),
      new THREE.ConeGeometry(0.065, 0.13, 7).translate(0, 0.095, 0),
      new THREE.ConeGeometry(0.05, 0.12, 7).translate(0, 0.17, 0),
      new THREE.ConeGeometry(0.032, 0.1, 7).translate(0, 0.24, 0),
    ].map((g) => g.toNonIndexed())),
    broadleaf: mergeGeometries([
      trunk(0.07, 0.01),
      new THREE.IcosahedronGeometry(0.065, 0).scale(1, 0.85, 1).translate(0, 0.12, 0),
    ].map((g) => g.toNonIndexed())),
    birch: mergeGeometries([
      trunk(0.12, 0.007),
      new THREE.IcosahedronGeometry(0.04, 0).scale(0.8, 1.5, 0.8).translate(0, 0.16, 0),
    ].map((g) => g.toNonIndexed())),
    shrub: mergeGeometries([
      new THREE.IcosahedronGeometry(0.035, 0).scale(1, 0.7, 1).translate(0, 0.022, 0),
      new THREE.IcosahedronGeometry(0.025, 0).scale(1, 0.7, 1).translate(0.03, 0.016, 0.01),
    ].map((g) => g.toNonIndexed())),
  };
  // Fireflies: tiny points that drift and blink along the trails at night.
  const fireflyMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uPx: { value: renderer.getPixelRatio() }, uStill: { value: 0 } },
    vertexShader: `
      attribute vec4 seed;            // phase, speed, drift radius, size
      uniform float uTime; uniform float uPx; uniform float uStill;
      varying float vBlink;
      void main() {
        float t = uTime * seed.y * 0.4 + seed.x * 6.2831;
        vec3 p = position + (1.0 - uStill) * vec3(sin(t * 0.7) * seed.z, sin(t * 1.3) * seed.z * 0.5, cos(t * 0.5) * seed.z);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // mostly dark, with short soft flashes
        float b = pow(max(0.0, sin(uTime * (0.18 + 0.22 * seed.y) + seed.x * 31.0)), 4.0);
        vBlink = mix(b, 0.35, uStill);
        gl_PointSize = seed.w * uPx * (0.6 + 0.6 * vBlink);
      }`,
    fragmentShader: `
      uniform float uNight; varying float vBlink;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * (0.6 + a), a * a * vBlink * uNight);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const tentGeo = new THREE.ConeGeometry(0.075, 0.1, 4).rotateY(Math.PI / 4).translate(0, 0.05, 0);
  const ringGeo = new THREE.RingGeometry(0.16, 0.2, 40).rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(0.16, 40).rotateX(-Math.PI / 2);
  const gemGeo = new THREE.OctahedronGeometry(0.075);
  const hitGeo = new THREE.SphereGeometry(0.42, 12, 8);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const SHARED = new Set([whiteMat, terrainMat, lineMat, glowMat, fireMat, haloMat, fireflyMat, accentMat, ...Object.values(TREE_GEOS), tentGeo, ringGeo, discGeo, gemGeo, hitGeo, hitMat]);
  const waterUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
  // Warm lights that spill onto the ground around camp and the tent at night.
  const campLight = new THREE.PointLight('#ffb066', 0, 1.6, 1.6);
  const tentLight = new THREE.PointLight('#ffb066', 0, 1.1, 1.6);
  world.add(campLight, tentLight);
  const m4 = new THREE.Matrix4();
  const BEAM = 0.75;

  let terrain, LM, rand, content = null;
  let trails = [], ripples = [];
  const hitTargets = [];

  function disposeContent() {
    if (!content) return;
    world.remove(content);
    content.traverse((o) => {
      if (o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => { if (!SHARED.has(m)) m.dispose(); });
      if (o.isInstancedMesh) o.dispose();
    });
    content = null;
  }

  function build(seed) {
    const t0 = performance.now();
    disposeContent();
    content = new THREE.Group();
    world.add(content);
    layoutPoints(seed);
    terrain = createTerrain({ ...CONFIG, seed }, sitesFor());
    LM = terrain.landmarks;

    const terrainMesh = new THREE.Mesh(
      terrain.geometry,
      terrainMat,
    );
    content.add(terrainMesh);

    const contourLines = new THREE.LineSegments(
      terrain.lineGeometry,
      lineMat,
    );
    content.add(contourLines);

    rand = mulberry32(seed + 101);

    // A spot is "flat" if the ground is the same slice all around it.
    const isFlat = (x, z, r = 0.12) => {
      const y = terrain.topAt(x, z);
      return [[r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => terrain.topAt(x + dx, z + dz) === y);
    };
    const inBounds = (x, z, m = 0.4) => Math.abs(x) < S - m && Math.abs(z) < S - m;

    // ----- points of interest -----
    POINTS.forEach((p) => {
      let x = p.at[0] * S, z = p.at[1] * S;
      p.trailGap = 0; // how far from the marker trails stop
      if (p.kind === 'falls') {
        // marker sits beside the stream, just back from the cliff edge
        x -= LM.falls.nx * 0.35 - LM.falls.nz * 0.3;
        z -= LM.falls.nz * 0.35 + LM.falls.nx * 0.3;
      }
      if (p.kind === 'lake') {
        // camp on the bank: find dry, flat ground just outside the water,
        // preferring the side that faces the default camera
        p.trailGap = 0.25;
        let spot = null;
        for (let k = 0; k < 40 && !spot; k++) {
          const a = Math.PI / 4 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.16;
          for (let d = LM.lake.r + 0.25; d < LM.lake.r + 0.8; d += 0.08) {
            const qx = LM.lake.x + Math.cos(a) * d, qz = LM.lake.z + Math.sin(a) * d;
            if (inBounds(qx, qz) && !terrain.isWater(qx, qz) && isFlat(qx, qz, 0.1)) { spot = [qx, qz, a]; break; }
          }
        }
        if (spot) { [x, z] = spot; p.bankAngle = spot[2]; }
      }
      if (p.kind === 'camp') p.trailGap = 0.7;
      let y = terrain.topAt(x, z);
      if (p.kind === 'peak') {
        // find the true summit near the requested spot
        let best = [x, z, y];
        for (let i = 0; i < 200; i++) {
          const a = i * 2.4, r = Math.sqrt(i / 200) * 0.8;
          const qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r, qy = terrain.topAt(qx, qz);
          if (qy > best[2]) best = [qx, qz, qy];
        }
        [x, z, y] = best;
      }
      p.ground = new THREE.Vector3(x, y, z);
    });

    // ----- trees -----
    const trees = [];
    const nearPoi = (x, z, d) => POINTS.some((p) => {
      const reach = p.kind === 'camp' ? d + 0.85 : p.kind === 'lake' ? d + LM.lake.r : d;
      return Math.hypot(p.ground.x - x, p.ground.z - z) < reach;
    });
    // Which kind of tree grows here depends on elevation:
    // broadleaf and shrubs low down, pines in the middle, spruce up high.
    const pickTree = (layer) => {
      const r = rand();
      if (layer >= 14) return r < 0.6 ? 'spruce' : r < 0.9 ? 'pine' : 'shrub';
      if (layer >= 10) return r < 0.55 ? 'pine' : r < 0.8 ? 'spruce' : 'broadleaf';
      return r < 0.55 ? 'broadleaf' : r < 0.8 ? 'shrub' : 'birch';
    };
    let guard = 0;
    while (trees.length < 190 && guard++ < 5000) {
      const cx = (rand() * 2 - 1) * (S - 0.6), cz = (rand() * 2 - 1) * (S - 0.6);
      const clusterLayer = terrain.layerAt(cx, cz);
      // fewer groves down in the flat valley floor
      if (clusterLayer < 8 && rand() < 0.7) continue;
      const count = 4 + Math.floor(rand() * 9);
      for (let i = 0; i < count; i++) {
        const x = cx + (rand() + rand() - 1) * 0.45, z = cz + (rand() + rand() - 1) * 0.45;
        if (!inBounds(x, z) || !isFlat(x, z, 0.07) || nearPoi(x, z, 0.35) || terrain.isWater(x, z)) continue;
        trees.push([x, terrain.topAt(x, z), z, 0.7 + rand() * 0.7, pickTree(terrain.layerAt(x, z))]);
      }
    }
    for (const [kind, geo] of Object.entries(TREE_GEOS)) {
      const list = trees.filter((t) => t[4] === kind);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geo, whiteMat, list.length);
      list.forEach(([x, y, z, s], i) => {
        m4.compose(
          new THREE.Vector3(x, y, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0)),
          new THREE.Vector3(s, s * (0.85 + rand() * 0.4), s),
        );
        mesh.setMatrixAt(i, m4);
      });
      content.add(mesh);
    }

    // ----- landmark details -----

    // A cabin: box with a pitched roof, door facing +z.
    function cabinGeometry(w, d, h, roofH) {
      const body = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
      const shape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.01, 0), new THREE.Vector2(w / 2 + 0.01, 0), new THREE.Vector2(0, roofH)]);
      const roof = new THREE.ExtrudeGeometry(shape, { depth: d + 0.02, bevelEnabled: false }).translate(0, h, -(d + 0.02) / 2);
      return mergeGeometries([body.toNonIndexed(), roof.index ? roof.toNonIndexed() : roof]);
    }

    function place(geo, mat, list) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, rot, sc = 1], i) => {
        m4.compose(
          new THREE.Vector3(x, terrain.topAt(x, z), z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
          new THREE.Vector3(sc, sc, sc),
        );
        mesh.setMatrixAt(i, m4);
      });
      content.add(mesh);
      return mesh;
    }

    // Base camp: a lodge, a row of cabins, a row of tents and a flag, laid out on a grid.
    if (LM.camp) {
      const cp = POINTS.find((p) => p.kind === 'camp').ground;
      const ang = -Math.PI / 4; // face the default camera
      const local = (u, v) => [cp.x + u * Math.cos(ang) - v * Math.sin(ang), cp.z + u * Math.sin(ang) + v * Math.cos(ang)];
      const rot = -ang;
      // The marker stands in the open square in the middle; buildings frame it.
      place(cabinGeometry(0.4, 0.22, 0.12, 0.09), whiteMat, [[...local(0, -0.5), rot]]);            // lodge
      place(cabinGeometry(0.14, 0.18, 0.08, 0.06), whiteMat,
        [[-0.48, -0.22], [-0.48, 0.05], [0.48, -0.22], [0.48, 0.05]].map(([u, v]) => [...local(u, v), rot + Math.PI / 2])); // cabins
      place(tentGeo, whiteMat, [-0.36, -0.18, 0.18, 0.36].map((u) => [...local(u, 0.42), rot]));     // tents
      // flagpole in the middle of camp
      const poleTop = 0.42;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, poleTop, 6).translate(0, poleTop / 2, 0), whiteMat);
      const [fx, fz] = local(0.26, -0.3);
      pole.position.set(fx, terrain.topAt(fx, fz), fz);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.07).translate(0.06, poleTop - 0.045, 0), accentMat);
      flag.rotation.y = rot;
      pole.add(flag);
      content.add(pole);
      // fire ring
      const fire = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16).rotateX(Math.PI / 2), whiteMat);
      const [rx, rz] = local(0, 0.26);
      fire.position.set(rx, terrain.topAt(rx, rz) + 0.008, rz);
      content.add(fire);
      // night lights: windows in the lodge and cabins, and the campfire
      const glowAt = (u, v, h, size) => { const [gx, gz] = local(u, v); addGlow(gx, terrain.topAt(gx, gz) + h, gz, size); };
      glowAt(0, -0.38, 0.06, 0.3);
      [[-0.4, -0.22], [-0.4, 0.05], [0.4, -0.22], [0.4, 0.05]].forEach(([u, v]) => glowAt(u, v, 0.05, 0.22));
      glowAt(0, 0.26, 0.05, 0.5, fireMat);
      glowAt(0, -0.05, 0.1, 1.8, haloMat);
      campLight.position.set(rx, terrain.topAt(rx, rz) + 0.25, rz);
    }

    // Small A-frame tent on the lake bank, beside the marker
    if (LM.lake) {
      const lp = POINTS.find((p) => p.kind === 'lake');
      const facing = lp.bankAngle ?? 0;
      const shape = new THREE.Shape([new THREE.Vector2(-0.09, 0), new THREE.Vector2(0.09, 0), new THREE.Vector2(0, 0.12)]);
      const tentA = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false }).translate(0, 0, -0.1);
      // find a flat, dry spot next to the marker
      let best = null;
      let fallback = null;
      search: for (const d of [0.34, 0.42, 0.52]) {
        for (const off of [1, -1, 1.5, -1.5, 0.6, -0.6, 2, -2]) {
          const a = facing + Math.PI / 2 * off;
          const tx = lp.ground.x + Math.cos(a) * d, tz = lp.ground.z + Math.sin(a) * d;
          if (terrain.isWater(tx, tz)) continue;
          fallback ??= [tx, tz];
          if (isFlat(tx, tz, 0.08)) { best = [tx, tz]; break search; }
        }
      }
      best ??= fallback;
      // turn the triangular doorway toward the default camera
      if (best) {
        place(tentA, whiteMat, [[best[0], best[1], Math.PI / 4]]);
        const ty = terrain.topAt(best[0], best[1]);
        addGlow(best[0], ty + 0.07, best[1], 0.4, fireMat); // lantern
        addGlow(best[0], ty + 0.08, best[1], 1.3, haloMat);
        tentLight.position.set(best[0], ty + 0.2, best[1]);
      }
    }

    // Summit cairn
    if (LM.peak) {
      const pk = POINTS.find((p) => p.kind === 'peak').ground;
      const cairn = new THREE.Group();
      [0.05, 0.04, 0.028].forEach((r, i) => {
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(r), whiteMat);
        stone.position.y = 0.03 + i * 0.05;
        cairn.add(stone);
      });
      cairn.position.set(pk.x + 0.12, terrain.topAt(pk.x + 0.12, pk.z), pk.z);
      content.add(cairn);
    }

    // Waterfall: animated sheets of falling water, one per step of the cascade
    if (LM.falls) {
      const f = LM.falls;
      const mat = new THREE.ShaderMaterial({
        uniforms: waterUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          varying vec2 vUv; uniform float uTime; uniform float uNight;
          float hash(float n){ return fract(sin(n)*43758.5453); }
          void main(){
            float col = floor(vUv.x * 9.0);
            float speed = 0.8 + hash(col) * 0.6;
            float streak = fract(vUv.y * 3.0 + uTime * speed + hash(col + 7.0));
            float a = mix(0.35, 0.95, smoothstep(0.2, 1.0, streak));
            float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
            vec3 day = mix(vec3(0.62,0.78,0.88), vec3(1.0), streak);
            vec3 night = mix(vec3(0.35,0.55,0.8), vec3(0.75,0.88,1.0), streak);
            gl_FragColor = vec4(mix(day, night, uNight), a * edge);
          }`,
      });
      f.sheets.forEach((sh) => {
        const height = sh.top - sh.bottom;
        if (height <= 0.01) return;
        const geo = new THREE.PlaneGeometry(f.width * 1.1, height, 1, 1).translate(0, sh.bottom + height / 2, 0);
        const sheet = new THREE.Mesh(geo, mat);
        // sit just in front of each cliff step, facing out
        const o = sh.offset + 0.03;
        sheet.position.set(f.x + f.nx * o, 0, f.z + f.nz * o);
        sheet.rotation.y = Math.atan2(f.nx, f.nz);
        content.add(sheet);
      });
    }

    // Lake: slow ripples on the surface
    ripples = [];
    if (LM.lake) {
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: '#cfe3ee', transparent: true, opacity: 0.3, depthWrite: false }),
        );
        ring.position.set(LM.lake.x, LM.lake.y + 0.004, LM.lake.z);
        ring.userData.phase = i / 3;
        content.add(ring);
        ripples.push(ring);
      }
    }

    // ----- trails between points -----
    trails = TRAILS.map(([ia, ib], n) => {
      const A = POINTS[ia], B = POINTS[ib];
      const route = planTrail(terrain, A.ground, B.ground, n)
        // stop short of each marker so the trail meets its edge, not its centre
        .filter((q) => Math.hypot(q.x - A.ground.x, q.y - A.ground.z) > A.trailGap &&
                       Math.hypot(q.x - B.ground.x, q.y - B.ground.z) > B.trailGap);
      const pts = route.map((q) => new THREE.Vector3(q.x, terrain.topAt(q.x, q.y) + 0.025, q.y));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({
        color: ACCENT, dashSize: 0.09, gapSize: 0.07, transparent: true, opacity: 0.7, fog: false,
      });
      const lineObj = new THREE.Line(geo, mat);
      lineObj.computeLineDistances();
      content.add(lineObj);
      return { line: lineObj, ends: [A.id, B.id], pts };
    });

    // ----- fireflies along the trails -----
    {
      const fr = mulberry32(seed * 7 + 5);
      const pos = [], sd = [];
      trails.forEach(({ pts }) => {
        const count = Math.max(2, Math.round(pts.length / 32));
        for (let i = 0; i < count; i++) {
          const q = pts[Math.floor(fr() * pts.length)];
          const a = fr() * Math.PI * 2, d = 0.05 + fr() * 0.16;
          const x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d;
          pos.push(x, terrain.topAt(x, z) + 0.05 + fr() * 0.14, z);
          sd.push(fr(), 0.5 + fr() * 0.9, 0.02 + fr() * 0.04, 4 + fr() * 4);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('seed', new THREE.Float32BufferAttribute(sd, 4));
      const flies = new THREE.Points(g, fireflyMat);
      flies.frustumCulled = false;
      content.add(flies);
    }

    // ----- markers -----
    hitTargets.length = 0;
    POINTS.forEach((p) => {
      const g = new THREE.Group();
      g.position.copy(p.ground);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, side: THREE.DoubleSide, fog: false }));
      ring.position.y = 0.012;
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.18, fog: false }));
      disc.position.y = 0.01;
      const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, BEAM, 0)]);
      const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: ACCENT, fog: false }));
      const gem = new THREE.Mesh(gemGeo, new THREE.MeshBasicMaterial({ color: ACCENT, fog: false }));
      gem.position.y = BEAM;
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.y = BEAM * 0.55;
      hit.userData.id = p.id;
      hitTargets.push(hit);
      g.add(ring, disc, beam, gem, hit);
      content.add(g);
      p.marker = { group: g, ring, disc, gem };
      p.anchor = new THREE.Vector3(0, BEAM + 0.12, 0);
    });
    console.info(`[topo] terrain ${seed} built in ${Math.round(performance.now() - t0)} ms`);
  } // end build()

  let currentSeed = CONFIG.seed;
  build(currentSeed);

  // HTML labels (mouse/touch targets; keyboard users use the nav or 1-4).
  POINTS.forEach((p, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'poi-label';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<span class="poi-num">${String(i + 1).padStart(2, '0')}</span><span class="poi-text"><span class="poi-name">${p.label}</span><span class="poi-place">${p.place}</span></span>`;
    el.addEventListener('click', () => goTo(p.id));
    el.addEventListener('pointerenter', () => setHover(p.id));
    el.addEventListener('pointerleave', () => setHover(null));
    labelLayer.appendChild(el);
    p.label_el = el;
  });


  // ----- controls -----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = false; // pan across the ground, not up into the sky
  controls.panSpeed = 0.8;
  controls.minPolarAngle = THREE.MathUtils.degToRad(12);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(78);
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;

  const HOME = { theta: THREE.MathUtils.degToRad(45), phi: THREE.MathUtils.degToRad(57) };
  const ORIGIN = new THREE.Vector3(0, 0, 0);

  function fitDistance() {
    const r = camera.aspect < 1 ? 7.4 : 6.4; // roughly the visible radius of the block
    const vf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    return r / Math.sin(Math.min(vf, hf));
  }
  const homePosition = () => new THREE.Vector3().setFromSphericalCoords(fitDistance(), HOME.phi, HOME.theta);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    controls.minDistance = 2.2;
    controls.maxDistance = fitDistance() * 1.8;
    applyViewOffset();
  }

  // When the section panel is open we shift the picture so the chosen
  // point isn't hidden behind the panel.
  let viewShift = 0;
  const wideQuery = window.matchMedia('(min-width: 800px)');
  function applyViewOffset() {
    const w = container.clientWidth, h = container.clientHeight;
    if (viewShift <= 0.001) {
      camera.clearViewOffset();
    } else if (wideQuery.matches) {
      const pw = Math.min(460, w * 0.45);
      camera.setViewOffset(w, h, (pw / 2) * viewShift, 0, w, h);
    } else {
      camera.setViewOffset(w, h, 0, h * 0.08 * viewShift, w, h);
    }
    camera.updateProjectionMatrix();
  }

  resize();
  camera.position.copy(homePosition());
  controls.target.copy(ORIGIN);
  controls.maxDistance = fitDistance() * 1.8;
  window.addEventListener('resize', resize);

  // ----- camera fly-to animation -----
  let tween = null;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function flyTo(position, target, shift, duration = 1400) {
    if (reducedMotion) duration = 0;
    if (duration === 0) {
      camera.position.copy(position);
      controls.target.copy(target);
      viewShift = shift;
      applyViewOffset();
      controls.update();
      tween = null;
      return;
    }
    tween = {
      p0: camera.position.clone(), t0: controls.target.clone(), s0: viewShift,
      p1: position.clone(), t1: target.clone(), s1: shift,
      start: performance.now(), duration,
    };
    controls.enabled = false;
  }

  // ----- sections -----
  let activeId = null;
  let returnFocusTo = null;

  function goTo(id) {
    if (location.hash === `#${id}`) openSection(id);
    else location.hash = id;
  }

  function openSection(id) {
    const p = POINTS.find((q) => q.id === id);
    const article = panel.querySelector(`article[data-section="${id}"]`);
    if (!p && !article) return;
    if (!activeId) returnFocusTo = document.activeElement;
    activeId = id;

    if (p) flyToPoint(p);
    else flyTo(camera.position.clone(), controls.target.clone(), 1, 600); // just make room for the panel

    articles.forEach((a) => (a.hidden = a.dataset.section !== id));
    panel.hidden = false;
    root.classList.add('panel-open');
    requestAnimationFrame(() => panel.classList.add('is-open'));
    navLinks.forEach((a) => {
      if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    POINTS.forEach((q) => q.label_el.classList.toggle('is-active', q.id === id));
    live.textContent = `Showing ${p ? p.label : article.querySelector('h2').textContent}. Press Escape to return to the map.`;
    const heading = panel.querySelector(`article[data-section="${id}"] h2`);
    heading?.focus({ preventScroll: true });
    panel.scrollTop = 0;
  }

  function flyToPoint(p) {
    const target = p.ground.clone().add(world.position).add(new THREE.Vector3(0, 0.25, 0));
    const offset = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    // look at the waterfall from in front of the cliff; pull back on the summit to see both peaks
    const theta = p.kind === 'falls' && LM.falls ? Math.atan2(LM.falls.nx, LM.falls.nz) : sph.theta;
    const dist = (wideQuery.matches ? 6.5 : 9) * (p.kind === 'peak' ? 1.35 : 1);
    const pos = new THREE.Vector3().setFromSphericalCoords(dist, THREE.MathUtils.degToRad(50), theta).add(target);
    flyTo(pos, target, 1);
  }

  function closeSection({ restoreFocus = true } = {}) {
    if (!activeId) return;
    activeId = null;
    panel.classList.remove('is-open');
    root.classList.remove('panel-open');
    const hide = () => { if (!activeId) panel.hidden = true; };
    if (reducedMotion) hide(); else setTimeout(hide, 350);
    navLinks.forEach((a) => a.removeAttribute('aria-current'));
    POINTS.forEach((q) => q.label_el.classList.remove('is-active'));
    flyTo(homePosition(), ORIGIN, 0);
    live.textContent = 'Back to the map overview.';
    if (restoreFocus && returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus({ preventScroll: true });
  }

  function backToMap() {
    if (location.hash) {
      try {
        history.pushState(null, '', location.pathname + location.search);
      } catch {
        // Some sandboxed previews block pushState; fall back to an empty hash.
        location.hash = '';
      }
    }
    closeSection();
  }

  function route() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (POINTS.some((p) => p.id === id) || EXTRA_SECTIONS.includes(id)) openSection(id);
    else closeSection();
  }
  window.addEventListener('hashchange', route);
  panelClose.addEventListener('click', backToMap);

  function resetView() {
    if (activeId) backToMap();
    else flyTo(homePosition(), ORIGIN, 0, 900);
  }

  // ----- hover + click on markers -----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoverId = null;

  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(hitTargets, false)[0];
    return hit ? hit.object.userData.id : null;
  }

  function setHover(id) {
    hoverId = id;
    renderer.domElement.style.cursor = id ? 'pointer' : '';
    POINTS.forEach((p) => p.label_el.classList.toggle('is-hover', p.id === id));
    trails.forEach((t) => {
      t.line.material.opacity = !id ? 0.7 : t.ends.includes(id) ? 1 : 0.25;
    });
  }

  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 6) return;
    const id = pick(e);
    if (id) goTo(id);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const id = pick(e);
    if (id !== hoverId) setHover(id);
  });
  renderer.domElement.addEventListener('pointerleave', () => setHover(null));

  // ----- keyboard -----
  const held = new Set();
  // Shift + arrow keys pan as well.
  const SHIFT_PAN = { ArrowUp: 'w', ArrowDown: 's', ArrowLeft: 'a', ArrowRight: 'd' };
  const KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    w: 'panF', s: 'panB', a: 'panL', d: 'panR',
    '+': 'in', '=': 'in', '-': 'out', '_': 'out',
  };

  // ----- map controls: compass, zoom buttons, map key -----
  function setLegend(open) {
    legend.hidden = !open;
    legendToggle.setAttribute('aria-expanded', String(open));
  }
  const legendOpen = () => legendToggle.getAttribute('aria-expanded') === 'true';
  legendToggle.addEventListener('click', () => setLegend(!legendOpen()));
  document.addEventListener('pointerdown', (e) => {
    if (legendOpen() && !legend.contains(e.target) && !legendToggle.contains(e.target)) setLegend(false);
  });

  function zoomBy(factor) {
    const offset = camera.position.clone().sub(controls.target);
    const r = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    flyTo(controls.target.clone().add(offset.setLength(r)), controls.target.clone(), viewShift, 450);
  }
  document.getElementById('zoom-in').addEventListener('click', () => zoomBy(0.7));
  document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1.4));
  document.getElementById('compass').addEventListener('click', () => resetView());

  // The compass needle always points to the map's north (the back edge).
  const rose = document.getElementById('compass-rose');
  let lastHeading = null;
  function updateCompass() {
    const heading = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    const deg = Math.round(THREE.MathUtils.radToDeg(heading) * 10) / 10;
    if (deg !== lastHeading) {
      rose.style.transform = `rotate(${deg}deg)`;
      lastHeading = deg;
    }
  }

  // A one-line hint for first-time visitors that fades once they interact.
  const hint = document.getElementById('hint');
  if (window.matchMedia('(pointer: coarse)').matches) hint.textContent = 'Drag to look around · Tap a marker';
  const hideHint = () => hint.classList.add('is-hidden');
  renderer.domElement.addEventListener('pointerdown', hideHint, { once: true });
  window.addEventListener('keydown', hideHint, { once: true });
  setTimeout(hideHint, 9000);

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

    if (e.key === 'Escape') {
      if (legendOpen()) { e.preventDefault(); setLegend(false); legendToggle.focus(); }
      else if (activeId) { e.preventDefault(); backToMap(); }
      return;
    }
    if (e.key.toLowerCase() === 'g' && !e.shiftKey && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      regenerate();
      return;
    }
    // Let the panel scroll normally when the keyboard is inside it.
    if (panel.contains(e.target)) return;

    let key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.shiftKey && SHIFT_PAN[key]) key = SHIFT_PAN[key];
    if (KEYS[key]) {
      e.preventDefault();
      held.add(KEYS[key]);
      return;
    }
    if (/^[1-9]$/.test(key) && POINTS[Number(key) - 1]) {
      e.preventDefault();
      goTo(POINTS[Number(key) - 1].id);
    } else if (key === 'n') {
      e.preventDefault();
      setNight(nightTarget < 0.5);
    } else if (key === 'r' || key === '0') {
      e.preventDefault();
      resetView();
    } else if (key === '?' || key === 'h') {
      e.preventDefault();
      setLegend(!legendOpen());
    }
  });
  window.addEventListener('keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS[key]) held.delete(KEYS[key]);
    if (SHIFT_PAN[key]) held.delete(KEYS[SHIFT_PAN[key]]);
    if (e.key === 'Shift') ['panF', 'panB', 'panL', 'panR'].forEach((k) => held.delete(k));
  });
  window.addEventListener('blur', () => held.clear());

  const sph = new THREE.Spherical();
  const tmp = new THREE.Vector3();
  function applyHeldKeys(dt) {
    if (!held.size || tween) return;
    const rot = 1.4 * dt; // radians per second
    tmp.copy(camera.position).sub(controls.target);
    sph.setFromVector3(tmp);
    if (held.has('left')) sph.theta -= rot;
    if (held.has('right')) sph.theta += rot;
    if (held.has('up')) sph.phi -= rot * 0.6;
    if (held.has('down')) sph.phi += rot * 0.6;
    if (held.has('in')) sph.radius *= Math.pow(0.4, dt);
    if (held.has('out')) sph.radius *= Math.pow(2.5, dt);
    sph.phi = THREE.MathUtils.clamp(sph.phi, controls.minPolarAngle, controls.maxPolarAngle);
    sph.radius = THREE.MathUtils.clamp(sph.radius, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(tmp.setFromSpherical(sph));

    // panning, relative to where the camera is facing
    const f = (held.has('panF') ? 1 : 0) - (held.has('panB') ? 1 : 0);
    const r = (held.has('panR') ? 1 : 0) - (held.has('panL') ? 1 : 0);
    if (f || r) {
      fwd.subVectors(controls.target, camera.position).setY(0).normalize();
      right.crossVectors(fwd, camera.up).normalize();
      const speed = sph.radius * 0.45 * dt;
      move.copy(fwd).multiplyScalar(f * speed).addScaledVector(right, r * speed);
      controls.target.add(move);
      camera.position.add(move);
    }
  }

  // Keep the view over the map so you can't pan off into empty space.
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  function clampTarget() {
    const lim = S * 0.85;
    const cx = THREE.MathUtils.clamp(controls.target.x, -lim, lim);
    const cz = THREE.MathUtils.clamp(controls.target.z, -lim, lim);
    move.set(cx - controls.target.x, 0, cz - controls.target.z);
    if (move.lengthSq() > 0) {
      controls.target.add(move);
      camera.position.add(move);
    }
  }

  motionQuery.addEventListener('change', (e) => {
    reducedMotion = e.matches;
    controls.enableDamping = !reducedMotion;
  });

  // ----- labels follow their markers -----
  const v3 = new THREE.Vector3();
  function updateLabels() {
    const w = container.clientWidth, h = container.clientHeight;
    POINTS.forEach((p) => {
      v3.copy(p.anchor);
      p.marker.group.localToWorld(v3);
      v3.project(camera);
      const visible = v3.z < 1 && Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2;
      p.label_el.style.visibility = visible ? '' : 'hidden';
      p.label_el.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px)`;
    });
  }

  // ----- regenerate: new random landscape; the places shuffle within their quadrants -----
  const regenButton = document.getElementById('regen');
  const seedLabel = document.getElementById('regen-seed');
  const SINK = 450;
  let regen = null;
  seedLabel.textContent = `Terrain no. ${currentSeed}`;

  function regenerate() {
    if (regen) return;
    let next;
    do { next = 1 + Math.floor(Math.random() * 99999); } while (next === currentSeed);
    regenButton.disabled = true;
    const finish = () => {
      currentSeed = next;
      build(next);
      setHover(null);
      seedLabel.textContent = `Terrain no. ${next}`;
      introStart = reducedMotion ? -Infinity : performance.now();
      regen = null;
      regenButton.disabled = false;
      live.textContent = `New terrain generated, number ${next}.`;
      const open = POINTS.find((p) => p.id === activeId); // places move, so follow the open one
      if (open) flyToPoint(open);
    };
    if (reducedMotion) finish();
    else regen = { start: performance.now(), finish };
  }
  regenButton.addEventListener('click', regenerate);

  // ----- day and night -----
  // The night sky is a real star map: about 2,000 stars from the Hipparcos
  // catalogue plus the constellation stick figures (js/sky-data.js). It is
  // turned to match tonight's sky at about 40° north for the visitor's time
  // zone, and keeps slowly turning in real time like the actual sky.
  // Stars below the horizon stay visible under the map, but much fainter.
  const sky = (() => {
    const R = 90;
    const LAT = THREE.MathUtils.degToRad(40);
    // RA/Dec to a point on the sphere, with the celestial pole along +Z.
    const eq = (ra, dec, r = R) => {
      const a = THREE.MathUtils.degToRad(ra), d = THREE.MathUtils.degToRad(dec);
      return [r * Math.cos(d) * Math.cos(a), r * Math.cos(d) * Math.sin(a), r * Math.sin(d)];
    };
    const pos = [], col = [], mag = [];
    const c = new THREE.Color();
    for (const [ra, dec, m, bv] of STARS) {
      pos.push(...eq(ra, dec));
      mag.push(m);
      // B-V colour index: blue-white stars (<0) to orange-red ones (>1.5).
      // Pulled toward white so the sky stays calm.
      const k = THREE.MathUtils.clamp((bv + 0.3) / 2.0, 0, 1);
      c.setRGB(0.75 + 0.25 * k, 0.85 + 0.05 * (1 - Math.abs(k - 0.4)), 1.0 - 0.35 * k);
      col.push(c.r, c.g, c.b);
    }
    const uniforms = { uOpacity: { value: 0 }, uPx: { value: renderer.getPixelRatio() }, uR: { value: R } };
    // Fade by altitude: full strength above the horizon, about a sixth below.
    const fade = `
      uniform float uOpacity; uniform float uR;
      float horizonFade(vec3 worldPos) {
        float alt = (worldPos.y - cameraPosition.y) / uR;
        return uOpacity * mix(0.5, 1.0, smoothstep(-0.04, 0.06, alt));
      }`;
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    starGeo.setAttribute('mag', new THREE.Float32BufferAttribute(mag, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        attribute float mag; attribute vec3 color; uniform float uPx;
        varying vec3 vColor; varying float vAlpha;
        ${fade}
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
          float b = clamp((5.4 - mag) / 6.5, 0.0, 1.0);    // 0 faint .. 1 brightest
          gl_PointSize = (2.8 + 5.5 * b * b) * uPx;
          vColor = color;
          vAlpha = (0.7 + 0.3 * b) * horizonFade(wp.xyz);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = 1.0 - smoothstep(0.2, 0.5, d);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
      transparent: true, depthWrite: false,
    });
    const starPts = new THREE.Points(starGeo, starMat);

    const seg = [];
    for (const line of CONSTELLATION_LINES) {
      for (let i = 0; i < line.length - 1; i++) seg.push(...eq(...line[i], R * 0.999), ...eq(...line[i + 1], R * 0.999));
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const lineMatSky = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying float vAlpha;
        ${fade}
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
          vAlpha = horizonFade(wp.xyz);
        }`,
      fragmentShader: `
        varying float vAlpha;
        void main() { gl_FragColor = vec4(0.62, 0.72, 0.92, 0.16 * vAlpha); }`,
      transparent: true, depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMatSky);

    // spin: turns with sidereal time about the celestial pole
    const spin = new THREE.Group();
    spin.add(starPts, lines);
    // tilt: puts the pole due north (-z) at 40° up, with east at +x
    const tilt = new THREE.Group();
    tilt.matrixAutoUpdate = false;
    tilt.matrix.makeBasis(
      new THREE.Vector3(0, Math.cos(LAT), Math.sin(LAT)),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, Math.sin(LAT), -Math.cos(LAT)),
    );
    tilt.add(spin);
    // the whole sky follows the camera so it never shifts as you pan or zoom
    const holder = new THREE.Group();
    holder.add(tilt);
    holder.renderOrder = -1;
    starPts.renderOrder = lines.renderOrder = -1;
    starPts.frustumCulled = lines.frustumCulled = false;
    holder.visible = false;
    scene.add(holder);

    // Local sidereal time: Earth's rotation relative to the stars.
    const lonGuess = -new Date().getTimezoneOffset() / 60 * 15; // rough longitude from time zone
    const turn = () => {
      const jd = Date.now() / 86400000 + 2440587.5;
      const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
      spin.rotation.z = -THREE.MathUtils.degToRad(gmst + lonGuess);
    };
    turn();
    return { holder, uniforms, turn };
  })();

  const THEME = {
    day:   { bg: '#141414', line: '#f2f2f2', lineOpacity: 0.85, hemi: 1.6, sun: 1.4, sunColor: '#ffffff', tree: '#555555', groundSky: '#202020' },
    night: { bg: '#0a0f1c', line: '#9fb6de', lineOpacity: 0.6, hemi: 0.5, sun: 0.75, sunColor: '#8fa8ff', tree: '#141a26', groundSky: '#0a0f1c' },
  };
  const cA = new THREE.Color(), cB = new THREE.Color();
  const mixColor = (a, b, t) => cA.set(a).lerp(cB.set(b), t);
  let night = 0, nightTarget = 0;
  function applyTime(t) {
    const D = THEME.day, Nn = THEME.night;
    const bg = mixColor(D.bg, Nn.bg, t);
    renderer.setClearColor(bg);
    scene.fog.color.copy(bg);
    lineMat.color.copy(mixColor(D.line, Nn.line, t));
    lineMat.opacity = D.lineOpacity + (Nn.lineOpacity - D.lineOpacity) * t;
    hemi.intensity = D.hemi + (Nn.hemi - D.hemi) * t;
    hemi.groundColor.copy(mixColor(D.groundSky, Nn.groundSky, t));
    sun.intensity = D.sun + (Nn.sun - D.sun) * t;
    sun.color.copy(mixColor(D.sunColor, Nn.sunColor, t));
    whiteMat.emissive.copy(mixColor(D.tree, Nn.tree, t));
    glowMat.opacity = t * 0.75;
    sky.uniforms.uOpacity.value = t;
    sky.holder.visible = t > 0.01;
    fireMat.opacity = t * 0.8;
    haloMat.opacity = t * 0.07;
    fireflyMat.uniforms.uNight.value = t;
    campLight.intensity = t * 0.35;
    tentLight.intensity = t * 0.3;
    waterUniforms.uNight.value = t;
  }

  const timeToggle = document.getElementById('time-toggle');
  function setNight(on, { instant = false } = {}) {
    nightTarget = on ? 1 : 0;
    if (instant || reducedMotion) { night = nightTarget; applyTime(night); }
    root.dataset.time = on ? 'night' : 'day';
    timeToggle.setAttribute('aria-pressed', String(on));
    timeToggle.setAttribute('aria-label', on ? 'Switch to day' : 'Switch to night');
  }
  timeToggle.addEventListener('click', () => setNight(nightTarget < 0.5));
  setNight(false, { instant: true }); // always opens in daytime

  // ----- intro: layers rise out of the ground -----
  let introStart = reducedMotion ? -Infinity : performance.now();
  const INTRO = 1600;

  status.textContent = '';
  root.classList.add('is-ready');
  if (location.hash) route();

  // ----- render loop -----
  const clock = new THREE.Clock();
  let frameCount = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();

    if (regen) {
      // sink the old land, then build the new one (which then rises)
      const k = Math.min(1, (now - regen.start) / SINK);
      world.scale.y = Math.max(0.001, 1 - k * k);
      root.classList.remove('labels-ready');
      if (k >= 1) regen.finish();
    } else {
      const k = Math.min(1, (now - introStart) / INTRO);
      const rise = 1 - Math.pow(1 - k, 3);
      world.scale.y = Math.max(0.001, rise);
      root.classList.toggle('labels-ready', k >= 1);
    }

    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.duration);
      const e = easeInOut(t);
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.t0, tween.t1, e);
      viewShift = tween.s0 + (tween.s1 - tween.s0) * e;
      applyViewOffset();
      camera.lookAt(controls.target);
      if (t >= 1) {
        tween = null;
        controls.enabled = true;
        controls.update();
      }
    } else {
      applyHeldKeys(dt);
      controls.update();
      clampTarget();
    }

    // ease between day and night
    if (night !== nightTarget) {
      night += Math.sign(nightTarget - night) * Math.min(Math.abs(nightTarget - night), dt * 1.2);
      applyTime(night);
    }

    // water, fireflies, flickering fire, and the turning sky
    if (!reducedMotion) waterUniforms.uTime.value = now / 2600; // slow, calm water
    if (night > 0.01) {
      fireflyMat.uniforms.uTime.value = now / 1000;
      fireflyMat.uniforms.uStill.value = reducedMotion ? 1 : 0;
      const flick = reducedMotion ? 1 : 0.8 + 0.12 * Math.sin(now / 90) + 0.08 * Math.sin(now / 37 + 1.3);
      fireMat.opacity = night * 0.8 * flick;
      campLight.intensity = night * 0.35 * flick;
      sky.holder.position.copy(camera.position);
      if ((frameCount++ & 255) === 0) sky.turn();
    }
    ripples.forEach((ring) => {
      const k = reducedMotion ? 0.5 + ring.userData.phase * 0.3 : (now / 15000 + ring.userData.phase) % 1;
      ring.scale.setScalar(0.15 + k * LM.lake.r * 0.85);
      ring.material.opacity = reducedMotion ? 0.25 : 0.4 * (1 - k);
    });

    // gentle pulse on the markers
    const pulse = reducedMotion ? 0 : (Math.sin(now / 1200) + 1) / 2;
    POINTS.forEach((p) => {
      const on = p.id === hoverId || p.id === activeId;
      const s = (on ? 1.35 : 1) + pulse * 0.25;
      p.marker.ring.scale.setScalar(s);
      p.marker.ring.material.opacity = 1 - pulse * 0.5;
      p.marker.gem.rotation.y = reducedMotion ? 0 : now / 2400;
      p.marker.gem.scale.setScalar(on ? 1.4 : 1);
    });

    // fade distant lines a little for depth
    const dist = camera.position.distanceTo(controls.target);
    scene.fog.near = dist - 2;
    scene.fog.far = dist + 16;

    renderer.render(scene, camera);
    updateLabels();
    updateCompass();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // handy for debugging in the browser console
  window.__topo = { scene, camera, controls, openSection, backToMap };
}
