// Offscreen passes run before the main render, each drawing the jelly bodies
// with one of their alternate materials (swapped in, then restored).

import * as THREE from 'three'

function swapRender(gl, group, camera, meshes, key, target, clear) {
  const prevTarget = gl.getRenderTarget()
  const prevColor = gl.getClearColor(new THREE.Color())
  const prevAlpha = gl.getClearAlpha()
  const prevAuto = gl.autoClear
  for (const m of meshes) m.material = m.userData.materials[key]
  gl.setRenderTarget(target)
  gl.setClearColor(clear[0], clear[1])
  gl.autoClear = false
  gl.clear(true, true, false)
  gl.render(group, camera)
  for (const m of meshes) m.material = m.userData.materials.main
  gl.setRenderTarget(prevTarget)
  gl.setClearColor(prevColor, prevAlpha)
  gl.autoClear = prevAuto
}

// Linear view depth of the nearest back face per pixel (half resolution is
// plenty: thickness varies slowly).
export class ThicknessPass {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    })
  }

  setSize(width, height) {
    this.target.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)))
  }

  render(gl, group, camera, meshes) {
    swapRender(gl, group, camera, meshes, 'back', this.target, [0x000000, 0])
  }

  dispose() {
    this.target.dispose()
  }
}
