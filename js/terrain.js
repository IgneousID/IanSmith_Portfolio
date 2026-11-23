// terrain.js
// Builds the stacked "contour layer" terrain block.
//
// How it works, in plain terms:
//  1. A noise function makes a smooth, hilly height map (0 = low, 1 = high).
//  2. The height range is cut into equal slices, like sheets of card.
//  3. For every slice we trace the outline of "everything higher than this
//     slice" (a technique called marching squares) and extrude it upward.
//  4. The top edge of every slice gets a thin white line. Stacked together
//     these lines become the contour lines you see in the reference.
//
// The numbers in CONFIG are the knobs worth playing with.

import * as THREE from 'three';

export const CONFIG = {
  seed: 11,          // change this number to get a completely different landscape
  size: 10,          // width and depth of the block, in scene units
  height: 2.8,       // height of the tallest point, in scene units
  layers: 22,        // how many contour slices
  resolution: 160,   // grid detail; higher = smoother outlines but slower to build
};

// ---------- small deterministic random + noise helpers ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRADS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];

function makePerlin(seed) {
  const rand = mulberry32(seed * 7919 + 17);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y) => {
    const g = GRADS[h & 7];
    return g[0] * x + g[1] * y;
  };
  return (x, y) => {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
    const u = fade(xf), v = fade(yf);
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v,
    ) * 1.4; // roughly -1..1
  };
}

// ---------- the terrain ----------

export function createTerrain(cfg = CONFIG, sites = {}) {
  const perlin = makePerlin(cfg.seed);
  const fbm = (x, y, octaves = 5) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * perlin(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
  const N = cfg.layers;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const slice = (h) => (Math.floor(h * N) + 0.5) / N; // middle of the slice that h falls in

  // The natural landscape before any landmarks are added.
  // x and z run from -1 to 1 across the block. Returns 0 (lowest) to 1 (highest).
  function naturalHeight(x, z) {
    let h = 0.58 + 0.55 * fbm(x * 1.15 + 3.7, z * 1.15 - 1.3);
    // Tilt the land so it rises toward the back, like the reference.
    h += 0.16 * -z + 0.06 * -x;
    // Carve a winding valley across the middle.
    const centre = 0.05 + 0.28 * Math.sin(x * 2.1 + 0.6);
    const d = z - centre;
    const valley = Math.exp(-(d * d) / 0.07);
    const floor = 0.34;
    h = h * (1 - 0.8 * valley) + floor * 0.8 * valley;
    return Math.max(h, floor);
  }

  // ----- landmarks: each one reshapes the land around it -----
  // Their exact shape varies with the seed, so every terrain is a little different.
  const vary = mulberry32(cfg.seed * 31 + 7);
  const between = (a, b) => a + (b - a) * vary();
  const F = {};

  if (sites.peak) {
    const [x, z] = sites.peak;
    // A major peak, plus a lower minor peak joined to it by a saddle.
    // set it off toward the front of the map so it reads clearly from the opening view
    const a = Math.PI / 4 + between(-1.3, 1.3), d = between(0.28, 0.4);
    let mx = x + Math.cos(a) * d, mz = z + Math.sin(a) * d;
    // keep the minor peak on the map
    mx = clamp(mx, -0.82, 0.82); mz = clamp(mz, -0.82, 0.82);
    // Each mountain gets its own character: how steep it is, how stretched,
    // which way its spurs (side ridges) run, and how deep the saddle dips.
    const spurs = () => [0, 1, 2].map((i) => ({ k: [2, 3, 5][i], amp: between(0.08, [0.3, 0.22, 0.12][i]), ph: between(0, 6.28) }));
    F.peak = {
      x, z, r: 0.3,
      slope: between(1.35, 1.75), stretch: between(1, 1.45), turn: between(0, Math.PI), spurs: spurs(),
      minor: {
        x: mx, z: mz, top: between(0.78, 0.88), slope: between(1.6, 2.1),
        stretch: between(1, 1.4), turn: between(0, Math.PI), spurs: spurs(),
      },
      // the ridge joining the two: how low the saddle sits, and how much it bends
      saddle: between(0.06, 0.16), bow: between(-0.1, 0.1), ridgeSlope: between(1.9, 2.6),
    };
  }
  if (sites.camp) {
    const [x, z] = sites.camp;
    F.camp = { x, z, r: 0.2, level: slice(clamp(naturalHeight(x, z), 0.5, 0.7)) };
  }
  if (sites.lake) {
    const [x, z] = sites.lake;
    const level = slice(clamp(naturalHeight(x, z) - 0.06, 0.45, 0.8));
    // Every lake has its own outline: stretched, turned, and pushed out into lobes.
    F.lake = {
      x, z, r: between(0.13, 0.18), level, water: level - 1 / N,
      stretch: between(1, 1.6), turn: between(0, Math.PI),
      lobes: [2, 3, 4].map((k, i) => ({ k, amp: between(0, [0.22, 0.18, 0.1][i]), ph: between(0, 6.28) })),
      rough: between(0.02, 0.05), noise: between(0, 50),
    };
  }
  if (sites.falls) {
    const { at: [x, z], angle, avoid = [] } = sites.falls;
    const nx = Math.cos(angle), nz = Math.sin(angle);
    // The cliff top matches the land just upstream, so water really flows down to it.
    const upstream = naturalHeight(x - nx * 0.3, z - nz * 0.3);
    const high = slice(clamp(Math.max(upstream, naturalHeight(x, z)) + 0.04, 0.6, 0.9));
    const tiers = vary() < 0.4 ? 2 : 1;                     // a single drop or a two-step cascade
    const maxDrop = Math.floor((high - 0.38) * N);
    const drops = tiers === 1
      ? [clamp(Math.round(between(4, 10)), 3, maxDrop)]
      : [clamp(Math.round(between(3, 5)), 2, maxDrop - 2), clamp(Math.round(between(2, 4)), 2, maxDrop - 3)];
    const levels = [high];
    drops.forEach((d) => levels.push(levels[levels.length - 1] - d / N));
    const mode = vary() < 0.5 ? 'river' : 'streams';
    const f = {
      x, z, nx, nz, r: 0.3, levels, tiers,
      tierGap: between(0.07, 0.1),
      curve: between(-2.5, 3),               // negative bows out, positive makes an amphitheatre
      halfWidth: mode === 'river' ? between(0.026, 0.034) : between(0.017, 0.021),
      mode,
    };
    f.stream = high - 1 / N;
    f.pool = levels[levels.length - 1] - 1 / N;
    f.poolS = f.tierGap * (tiers - 1) + 0.075;

    // Trace the water upstream from the top of the falls: always climb, so it
    // reads as water flowing down the slope toward the edge.
    const trace = (sx, sz, dx, dz, length, stepLen = 0.02) => {
      const pts = [[sx, sz]];
      let px = sx, pz = sz;
      for (let i = 0; i < length / stepLen; i++) {
        const e = 0.01, h0 = naturalHeight(px, pz);
        let gx = naturalHeight(px + e, pz) - naturalHeight(px - e, pz);
        let gz = naturalHeight(px, pz + e) - naturalHeight(px, pz - e);
        const gl = Math.hypot(gx, gz);
        if (gl > 1e-5) { gx /= gl; gz /= gl; } else { gx = dx; gz = dz; }
        // mostly uphill, with some memory of the previous direction and a little wander
        dx = dx * 0.55 + gx * 0.45 + (vary() - 0.5) * 0.25;
        dz = dz * 0.55 + gz * 0.45 + (vary() - 0.5) * 0.25;
        const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
        const qx = px + dx * stepLen, qz = pz + dz * stepLen;
        if (Math.abs(qx) > 0.85 || Math.abs(qz) > 0.85) break;
        if (avoid.some(([ax, az, ar]) => Math.hypot(qx - ax, qz - az) < ar)) break;
        if (naturalHeight(qx, qz) < h0 - 0.02) break; // don't run uphill against the flow
        px = qx; pz = qz;
        pts.push([px, pz]);
      }
      return pts;
    };
    const top = [x - nx * f.r * 0.5, z - nz * f.r * 0.5];
    f.channels = [];
    const addChannel = (pts, halfWidth, startLevel) => {
      // water level never rises as you go downstream
      const lv = [];
      let level = startLevel;
      for (const [px, pz] of pts) {
        level = Math.max(level, slice(naturalHeight(px, pz)) - 1 / N);
        lv.push(Math.min(level, high + 3 / N));
      }
      const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]), m = halfWidth + 0.01;
      f.channels.push({ pts, lv, halfWidth, box: [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m] });
    };
    if (mode === 'river') {
      addChannel(trace(top[0], top[1], -nx, -nz, between(0.35, 0.55)), f.halfWidth * 0.8, f.stream);
    } else {
      const main = trace(top[0], top[1], -nx, -nz, between(0.08, 0.14));
      addChannel(main, f.halfWidth, f.stream);
      const [ex, ez] = main[main.length - 1];
      const branches = vary() < 0.5 ? 2 : 3;
      for (let i = 0; i < branches; i++) {
        const spread = (i - (branches - 1) / 2) * between(0.7, 1.1);
        const c = Math.cos(spread), sn = Math.sin(spread);
        const bx = -nx * c - -nz * sn, bz = -nx * sn + -nz * c;
        addChannel(trace(ex, ez, bx, bz, between(0.18, 0.32)), 0.013, f.stream);
      }
    }
    F.falls = f;
  }

  // Distance from a point to a polyline, and the water level at the nearest spot.
  function nearestOnChannel(ch, x, z) {
    let best = Infinity, lvl = 0;
    const p = ch.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      const vx = bx - ax, vz = bz - az;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d < best) { best = d; lvl = t < 0.5 ? ch.lv[i] : ch.lv[i + 1]; }
    }
    return [best, lvl];
  }

  // Distance from a centre, but stretched along one direction and pushed in
  // or out by angle, so outlines aren't perfect circles.
  function shapedDistance(x, z, c, waves, warp = 0) {
    const dx = x - c.x, dz = z - c.z;
    const ca = Math.cos(c.turn), sa = Math.sin(c.turn);
    const u = (dx * ca + dz * sa) / c.stretch, v = -dx * sa + dz * ca;
    const d = Math.hypot(u, v);
    const th = Math.atan2(v, u) + warp;
    let wave = 0;
    for (const w of waves) wave += w.amp * Math.cos(w.k * th + w.ph);
    return [d, wave];
  }
  // One mountain: a cone whose sides have spurs and gullies.
  function mountain(x, z, c, top, slope) {
    const warp = 0.7 * perlin(x * 3 + c.x * 9, z * 3 - c.z * 9);
    const [d, wave] = shapedDistance(x, z, c, c.spurs, warp);
    // spurs reach further out on the lower slopes than near the top
    const dEff = d * (1 - wave * smooth(0.0, 0.14, d));
    return top - dEff * slope;
  }

  // Height with landmarks applied. Also reports whether the spot is water.
  let water = false;
  function heightAt(x, z) {
    water = false;
    let h = naturalHeight(x, z);

    if (F.peak) {
      const P = F.peak, m = P.minor;
      const d = Math.hypot(x - P.x, z - P.z);
      const dm = Math.hypot(x - m.x, z - m.z);
      // the ridge: a line from the major summit to the minor one that bends a
      // little and dips into a saddle in the middle
      const vx = m.x - P.x, vz = m.z - P.z, len = Math.hypot(vx, vz);
      let t = clamp(((x - P.x) * vx + (z - P.z) * vz) / (len * len), 0, 1);
      const bend = P.bow * Math.sin(Math.PI * t);
      const px = P.x + vx * t - (vz / len) * bend, pz = P.z + vz * t + (vx / len) * bend;
      const across = Math.hypot(x - px, z - pz) * (1 + 0.35 * perlin(t * 6 + 2, 4.1));
      const crest = 0.99 + (m.top - 0.99) * t - P.saddle * Math.sin(Math.PI * t) + 0.02 * perlin(t * 9, 1.3);
      const ridge = crest - across * P.ridgeSlope;
      const wob = 0.025 * perlin(x * 7, z * 7);
      const cone = Math.max(mountain(x, z, P, 0.99, P.slope), mountain(x, z, m, m.top, m.slope), ridge) + wob;
      const R2 = P.r * P.r;
      const g = Math.max(
        Math.exp(-(d * d) / (R2 * 2.2)),
        Math.exp(-(dm * dm) / (R2 * 1.2)),
        Math.exp(-(across * across) / R2) * (t > 0 && t < 1 ? 1 : 0.6),
      );
      h = Math.max(h, h * (1 - g) + cone * g);
    }

    if (F.camp) {
      // a flat terrace for the buildings
      const d = Math.hypot(x - F.camp.x, z - F.camp.z) + 0.02 * perlin(x * 9, z * 9);
      const w = 1 - smooth(F.camp.r, F.camp.r * 1.9, d);
      h = h * (1 - w) + F.camp.level * w;
    }

    if (F.lake) {
      const L = F.lake;
      const [q, wave] = shapedDistance(x, z, L, L.lobes);
      // distance measured against this lake's own wobbly outline
      const d = q / (1 + wave) + L.rough * perlin(x * 8 + L.noise, z * 8);
      const w = 1 - smooth(L.r, L.r * 2, d);
      h = h * (1 - w) + L.level * w;
      if (d < L.r) { h = L.water; water = true; }
    }

    if (F.falls) {
      const f = F.falls;
      const dx = x - f.x, dz = z - f.z;
      const s = dx * f.nx + dz * f.nz;   // across the cliff (negative = top)
      const t = -dx * f.nz + dz * f.nx;  // along the cliff edge
      // a curved, slightly ragged cliff edge
      const edge = s - f.curve * t * t + 0.03 * perlin(t * 10 + 3, 1.7) * smooth(0.03, 0.09, Math.abs(t));
      const w = 1 - smooth(f.r * 0.55, f.r, Math.hypot(s * 1.3, t));
      if (w > 0) {
        let level = f.levels[0];
        for (let i = 1; i <= f.tiers; i++) if (edge >= f.tierGap * (i - 1)) level = f.levels[i];
        h = h * (1 - w) + level * w;
        if (w > 0.6) {
          // the water running over each step of the falls
          const wobble = 0.006 * perlin(s * 20, 4);
          if (Math.abs(t) < f.halfWidth + wobble && s > -f.r * 0.5 && edge < f.tierGap * (f.tiers - 1)) {
            h = level - 1 / N; water = true;
          }
          // plunge pool at the bottom
          const pd = Math.hypot(s - f.poolS, t * 0.8);
          if (pd < 0.065) { h = f.pool; water = true; }
        }
      }
      // the river or streams feeding the falls
      if (!water && w < 0.75) {
        for (const ch of f.channels) {
          if (x < ch.box[0] || x > ch.box[1] || z < ch.box[2] || z > ch.box[3]) continue;
          const [d, lvl] = nearestOnChannel(ch, x, z);
          // the water sits one contour below the ground it runs through, so it follows the slope
          if (d < ch.halfWidth + 0.004 * perlin(x * 30, z * 30)) { h = Math.min(slice(h) - 1 / N, Math.max(lvl, slice(h) - 2 / N)); water = true; break; }
        }
      }
    }
    return clamp(h, 0, 1);
  }

  const isWaterAt = (x, z) => { heightAt(x, z); return water; };

  const R = cfg.resolution;
  const EXT = 1.05; // grid reaches slightly past the block edge
  const S = cfg.size / 2;
  const step = cfg.height / N;
  const nodes = R + 1;
  const coord = (i) => -EXT + (2 * EXT * i) / R;

  // Signed "inside" value for layer L at domain point (x, z).
  // Positive = solid, negative = air. Each layer also gets its own slightly
  // wobbly outer edge so the sides of the block look hand cut.
  const edgeValue = (L, x, z) =>
    (1 - Math.max(Math.abs(x), Math.abs(z)) - L * 0.0012 +
      0.011 * perlin(x * 6 + L * 1.7, z * 6 - L * 2.3)) * 8;

  const base = new Float32Array(nodes * nodes);
  const wet = new Uint8Array(nodes * nodes);
  for (let j = 0; j < nodes; j++) {
    for (let i = 0; i < nodes; i++) {
      base[j * nodes + i] = heightAt(coord(i), coord(j));
      wet[j * nodes + i] = water ? 1 : 0;
    }
  }

  const fields = [];
  for (let L = 0; L < N; L++) {
    const thr = L / N;
    const F = new Float32Array(nodes * nodes);
    const prev = fields[L - 1];
    for (let j = 0; j < nodes; j++) {
      for (let i = 0; i < nodes; i++) {
        const k = j * nodes + i;
        let v = Math.min(base[k] - thr, edgeValue(L, coord(i), coord(j)));
        if (prev) v = Math.min(v, prev[k]); // a layer never overhangs the one below
        F[k] = v === 0 ? -1e-6 : v;
      }
    }
    fields.push(F);
  }

  // ----- build geometry with marching squares -----
  const pos = [], nor = [], col = [], line = [];
  // Colours (linear values): land tops, walls, and water.
  const TOP = [0.022, 0.022, 0.022], SIDE = [0.006, 0.006, 0.006], WATER = [0.03, 0.055, 0.075];
  let capColour = TOP;

  const tri = (a, b, c, y) => {
    // a, b, c are [x, z]; make sure the triangle faces up
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cross < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      pos.push(p[0], y, p[1]);
      nor.push(0, 1, 0);
      col.push(capColour[0], capColour[1], capColour[2]);
    }
  };

  const wall = (a, b, cx, cz, y0, y1) => {
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    let nx = dz / len, nz = -dx / len;
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    // winding so the face points along (nx, nz)
    if (-dz * nx + dx * nz < 0) { [a, b] = [b, a]; }
    const quad = [
      [a, y0], [b, y0], [b, y1],
      [a, y0], [b, y1], [a, y1],
    ];
    for (const [p, y] of quad) {
      pos.push(p[0], y, p[1]);
      nor.push(nx, 0, nz);
      col.push(SIDE[0], SIDE[1], SIDE[2]);
    }
  };

  for (let L = 0; L < N; L++) {
    const F = fields[L];
    const Fn = fields[L + 1];
    const yTop = (L + 1) * step;
    const yBot = L * step;
    for (let cj = 0; cj < R; cj++) {
      for (let ci = 0; ci < R; ci++) {
        const k00 = cj * nodes + ci;
        const ks = [k00, k00 + 1, k00 + nodes + 1, k00 + nodes];
        const v = ks.map((k) => F[k]);
        const inside = v.map((a) => a >= 0);
        const mask = (inside[0] ? 1 : 0) | (inside[1] ? 2 : 0) | (inside[2] ? 4 : 0) | (inside[3] ? 8 : 0);
        if (mask === 0) continue;
        const x0 = coord(ci) * S, x1 = coord(ci + 1) * S;
        const z0 = coord(cj) * S, z1 = coord(cj + 1) * S;
        const p = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
        // Water colour where this slice is the water surface.
        capColour = ks.some((k) => wet[k] && Math.floor(base[k] * N) === L) ? WATER : TOP;

        if (mask === 15) {
          // Skip tops that are completely covered by the next layer up.
          if (Fn && ks.every((k) => Fn[k] >= 0)) continue;
          tri(p[0], p[1], p[2], yTop);
          tri(p[0], p[2], p[3], yTop);
          continue;
        }

        const edge = (k) => {
          const a = k, b = (k + 1) % 4;
          const t = v[a] / (v[a] - v[b]);
          return [p[a][0] + (p[b][0] - p[a][0]) * t, p[a][1] + (p[b][1] - p[a][1]) * t];
        };

        let polys;
        const saddle = mask === 5 || mask === 10;
        if (saddle && (v[0] + v[1] + v[2] + v[3]) < 0) {
          polys = [];
          for (let k = 0; k < 4; k++) {
            if (!inside[k]) continue;
            polys.push([
              { p: edge((k + 3) % 4), e: true },
              { p: p[k], e: false },
              { p: edge(k), e: true },
            ]);
          }
        } else {
          const poly = [];
          for (let k = 0; k < 4; k++) {
            if (inside[k]) poly.push({ p: p[k], e: false });
            if (inside[k] !== inside[(k + 1) % 4]) poly.push({ p: edge(k), e: true });
          }
          polys = [poly];
        }

        for (const poly of polys) {
          for (let m = 1; m < poly.length - 1; m++) tri(poly[0].p, poly[m].p, poly[m + 1].p, yTop);
          let cx = 0, cz = 0;
          for (const q of poly) { cx += q.p[0]; cz += q.p[1]; }
          cx /= poly.length; cz /= poly.length;
          for (let m = 0; m < poly.length; m++) {
            const a = poly[m], b = poly[(m + 1) % poly.length];
            if (a.e && b.e) {
              wall(a.p, b.p, cx, cz, yBot, yTop);
              line.push(a.p[0], yTop, a.p[1], b.p[0], yTop, b.p[1]);
              if (L === 0) line.push(a.p[0], 0, a.p[1], b.p[0], 0, b.p[1]);
            }
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));

  // Height (in scene units) of the top surface at scene point (x, z).
  function topAt(x, z) {
    const dx = x / S, dz = z / S;
    const h = heightAt(dx, dz);
    let top = -1, v = Infinity;
    for (let L = 0; L < N; L++) {
      v = Math.min(v, h - L / N, edgeValue(L, dx, dz));
      if (v < 0) break;
      top = L;
    }
    return (top + 1) * step;
  }

  // Which slice is the ground at (x, z)? Useful for "is this a hill or a valley".
  function layerAt(x, z) {
    return Math.round(topAt(x, z) / step) - 1;
  }

  // Scene-unit helpers for the landmarks.
  const ySlice = (h) => (Math.floor(h * N) + 1) * step;
  const landmarks = {};
  if (F.falls) {
    const f = F.falls;
    landmarks.falls = {
      x: f.x * S, z: f.z * S, nx: f.nx, nz: f.nz, width: f.halfWidth * 2 * S,
      // one sheet of falling water per step of the cascade
      sheets: f.levels.slice(1).map((lv, i) => ({
        offset: f.tierGap * i * S,
        top: ySlice(f.levels[i] - 1 / N),
        bottom: ySlice(i === f.tiers - 1 ? f.pool : lv - 1 / N),
      })),
    };
  }
  if (F.lake) landmarks.lake = { x: F.lake.x * S, z: F.lake.z * S, r: F.lake.r * S, y: ySlice(F.lake.water) };
  if (F.camp) landmarks.camp = { x: F.camp.x * S, z: F.camp.z * S, r: F.camp.r * S, y: ySlice(F.camp.level) };
  if (F.peak) landmarks.peak = { x: F.peak.x * S, z: F.peak.z * S, minor: { x: F.peak.minor.x * S, z: F.peak.minor.z * S } };

  return {
    geometry, lineGeometry, topAt, layerAt, step, half: S, perlin, cfg, landmarks,
    isWater: (x, z) => isWaterAt(x / S, z / S),
  };
}
