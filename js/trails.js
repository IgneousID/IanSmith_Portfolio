// trails.js
// Finds a walking route between two points that behaves like a real trail:
// it prefers gentle ground, avoids climbing cliffs, stays out of water,
// and wanders a little instead of running in a straight line.
//
// It works like a map app's route finder (an algorithm called A*): the
// map is split into a grid, every step has a "cost", and the cheapest
// route wins. Steep steps and water cost a lot, so the route goes around.

import * as THREE from 'three';

const GRID = 110;          // grid cells across the map
const CLIMB = 3;           // cost of stepping up or down one contour
const CLIFF = 60;          // cost per contour when the step is steeper than that
const WATER = 200;         // cost of stepping into water
const WANDER = 3.5;        // how much the trail meanders (0 = direct)

export function planTrail(terrain, from, to, index = 0) {
  const S = terrain.half;
  const margin = 0.35;
  const size = (2 * (S - margin)) / GRID;
  const toCell = (v) => THREE.MathUtils.clamp(Math.round((v + S - margin) / size), 0, GRID);
  const toWorld = (i) => -S + margin + i * size;
  const n = GRID + 1;

  // Sample the land once per grid point.
  const layer = new Int16Array(n * n);
  const wet = new Uint8Array(n * n);
  const wander = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = toWorld(i), z = toWorld(j), k = j * n + i;
      layer[k] = terrain.layerAt(x, z);
      wet[k] = terrain.isWater(x, z) ? 1 : 0;
      // smooth noise makes some areas "nicer to walk", so the trail drifts
      wander[k] = 1 + WANDER * (0.5 + 0.5 * terrain.perlin(x * 0.8 + index * 13.1, z * 0.8 - index * 7.7));
    }
  }

  const start = toCell(from.z) * n + toCell(from.x);
  const goal = toCell(to.z) * n + toCell(to.x);
  const gx = goal % n, gz = Math.floor(goal / n);

  const cost = new Float32Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = new MinHeap();
  cost[start] = 0;
  heap.push(start, 0);

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.size) {
    const k = heap.pop();
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % n, j = Math.floor(k / n);
    for (const [di, dj] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nk = nj * n + ni;
      if (closed[nk]) continue;
      const dist = di && dj ? Math.SQRT2 : 1;
      const dl = Math.abs(layer[nk] - layer[k]);
      let step = dist * (wander[k] + wander[nk]) * 0.5;
      if (dl === 1) step += CLIMB;
      else if (dl > 1) step += CLIFF * dl;
      if (wet[nk] && nk !== goal) step += WATER;
      const c = cost[k] + step;
      if (c < cost[nk]) {
        cost[nk] = c;
        prev[nk] = k;
        const h = Math.hypot(ni - gx, nj - gz); // straight-line estimate
        heap.push(nk, c + h);
      }
    }
  }

  // Walk back from the goal to build the route.
  let pts = [];
  for (let k = goal; k !== -1; k = prev[k]) {
    pts.push(new THREE.Vector2(toWorld(k % n), toWorld(Math.floor(k / n))));
    if (k === start) break;
  }
  pts.reverse();
  pts[0] = new THREE.Vector2(from.x, from.z);
  pts[pts.length - 1] = new THREE.Vector2(to.x, to.z);

  // Round off the grid's corners so it reads as a hand-drawn trail.
  for (let pass = 0; pass < 4; pass++) pts = chaikin(pts);
  return pts;
}

function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push(a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

class MinHeap {
  constructor() { this.keys = []; this.vals = []; }
  get size() { return this.keys.length; }
  push(key, val) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key); vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (vals[p] <= vals[i]) break;
      [keys[p], keys[i]] = [keys[i], keys[p]];
      [vals[p], vals[i]] = [vals[i], vals[p]];
      i = p;
    }
  }
  pop() {
    const { keys, vals } = this;
    const top = keys[0];
    const lastK = keys.pop(), lastV = vals.pop();
    if (keys.length) {
      keys[0] = lastK; vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < keys.length && vals[l] < vals[m]) m = l;
        if (r < keys.length && vals[r] < vals[m]) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [vals[m], vals[i]] = [vals[i], vals[m]];
        i = m;
      }
    }
    return top;
  }
}
