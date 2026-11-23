// places.js
// The places on the map, where they go, and which ones trails join.
// Shared by the home page map (main.js) and the mini map on case study pages.

import { mulberry32 } from './terrain.js';

// ---------------------------------------------------------------------------
// Points of interest. `id` must match a link in the nav (href="#id") and an
// <article data-section="id"> in index.html. `page` is the full case study. Each place lives in its own
// quarter of the map (`quadrant`: x and z signs, -1 = left/back, 1 = right/front)
// and moves around inside it every time the terrain is regenerated.
// ---------------------------------------------------------------------------
// `kind` picks the landform the terrain builds there: camp, peak, falls or lake.
export const POINTS = [
  { id: 'about',     label: 'About me',  place: 'Base camp', kind: 'camp',  quadrant: [-1, 1] },
  { id: 'project-1', label: 'DFW Consumer Council', place: 'Summit',    kind: 'peak',  page: 'dfw-consumer-council.html',  quadrant: [-1, -1] },
  { id: 'project-2', label: 'Cooperative Connections', place: 'The falls', kind: 'falls', page: 'cooperative-connections.html', quadrant: [1, -1] },
  { id: 'project-3', label: 'HeatWise', place: 'The lake',  kind: 'lake',  page: 'heatwise.html',  quadrant: [1, 1] },
];
// Sections that open in the panel but have no place on the map.
export const EXTRA_SECTIONS = ['contact'];
// Spacing rules for random placement (map units, -1..1 across the block).
const MIN_GAP = 0.62;     // places never closer than this to each other
const EDGE_MARGIN = 0.3;  // ...or closer than this to the edge
const QUAD_INNER = 0.22;  // ...or closer than this to the middle lines

// Pick a position for every place, inside its quadrant, following the rules above.
export function layoutPoints(seed) {
  const r = mulberry32(seed * 17 + 3);
  const span = 1 - EDGE_MARGIN - QUAD_INNER;
  let pos = null;
  for (let attempt = 0; attempt < 500 && !pos; attempt++) {
    const tryPos = POINTS.map((p) => [
      p.quadrant[0] * (QUAD_INNER + r() * span),
      p.quadrant[1] * (QUAD_INNER + r() * span),
    ]);
    const ok = tryPos.every((a, i) => tryPos.every((b, j) => i >= j || Math.hypot(a[0] - b[0], a[1] - b[1]) >= MIN_GAP));
    if (ok) pos = tryPos;
  }
  pos ??= POINTS.map((p) => [p.quadrant[0] * 0.5, p.quadrant[1] * 0.5]);
  POINTS.forEach((p, i) => {
    p.at = pos[i];
    // waterfalls face roughly toward the opening camera view, so the drop is visible
    if (p.kind === 'falls') p.angle = Math.PI / 4 + (r() - 0.5) * 1.2;
  });
}
// Which points are joined by trails (by index in POINTS).
export const TRAILS = [[0, 1], [1, 2], [2, 3], [0, 3]];

// What the terrain generator needs to know about each place.
export function sitesFor(points = POINTS) {
  const sites = {};
  points.forEach((p) => {
    sites[p.kind] = p.kind === 'falls'
      ? { at: p.at, angle: p.angle, avoid: points.filter((q) => q !== p).map((q) => [q.at[0], q.at[1], 0.3]) }
      : p.at;
  });
  return sites;
}
