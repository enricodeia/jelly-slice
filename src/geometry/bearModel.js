// Everything a whole bear needs, built once and shared by every bear: the
// moulded render mesh, its soup form for cutting, the simulation lattice, the
// trilinear embedding of the render vertices, and the collision proxies.

import { sdBear, BEAR_BOUNDS, bakeRelief } from './sdfBear.js'
import { surfaceNets, checkManifold } from './surfaceNets.js'
import { soupFromIndexed, meshVolume } from './planeCut.js'
import { createGrid, bearCells, buildLattice, embedPoints, farthestPoints, surfaceArea } from '../sim/lattice.js'

// first choice, then fallbacks: naive surface nets can pinch a crease at some
// grid alignments, and the cutter needs a closed, manifold mesh
export const MESH_CELLS = [0.033, 0.032, 0.031, 0.03, 0.035, 0.036]
export const LATTICE_CELL = 0.26 // ≈ the constraint budget of the old bear at 0.22: ~60 fps with 40 pieces
export const BEAR_PROXIES = 110

let cached = null

export function getBearModel() {
  if (cached) return cached
  let m = null
  for (const h of MESH_CELLS) {
    m = surfaceNets(sdBear, BEAR_BOUNDS.min, BEAR_BOUNDS.max, h)
    const check = checkManifold(m.index)
    if (!check.boundary && !check.duplicated) break
  }
  const soup = soupFromIndexed(m.positions, m.normals, m.index)
  const grid = createGrid(BEAR_BOUNDS.min, BEAR_BOUNDS.max, LATTICE_CELL)
  const cells = bearCells(grid, sdBear, m.positions)
  const lattice = buildLattice(grid, cells)
  const render = {
    positions: m.positions,
    normals: m.normals,
    skin: new Float32Array(m.positions.length / 3).fill(1),
    index: m.index,
    embed: embedPoints(grid, lattice, m.positions),
  }
  const fps = farthestPoints(soup.positions, soup.posId, BEAR_PROXIES)
  const vol = meshVolume(soup)
  cached = {
    soup,
    grid,
    lattice,
    render,
    proxyPoints: fps.points,
    proxyEmbed: embedPoints(grid, lattice, fps.points),
    proxyRadius: fps.spacing * 0.55,
    area: surfaceArea(soup.positions),
    volume: vol.volume,
    centroid: [vol.cx, vol.cy, vol.cz],
    relief: bakeRelief(),
  }
  return cached
}
