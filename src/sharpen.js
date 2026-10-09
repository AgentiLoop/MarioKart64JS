// Contrast-adaptive sharpening (after AMD FidelityFX CAS) for the 2× preset: after the frame is drawn, it is
// copied off the canvas, sharpened and drawn back, before CSS stretches the 480-line canvas to the window.
// The copy holds the displayed (sRGB) values, so the sky and other unconverted shaders come out unchanged.
import * as THREE from 'three';

export function createSharpen(renderer, sharpness = 0.8) {
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, texel: { value: new THREE.Vector2() }, peak: { value: -1 / THREE.MathUtils.lerp(8, 5, sharpness) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D map; uniform vec2 texel; uniform float peak; varying vec2 vUv;
      vec3 at(float x, float y) { return texture2D(map, vUv + vec2(x, y) * texel).rgb; }
      void main() {
        vec3 a = at(-1., -1.), b = at(0., -1.), c = at(1., -1.), d = at(-1., 0.), e = at(0., 0.), f = at(1., 0.), g = at(-1., 1.), h = at(0., 1.), i = at(1., 1.);
        vec3 mn = min(min(min(d, e), min(f, b)), h), mx = max(max(max(d, e), max(f, b)), h);
        mn += min(mn, min(min(a, c), min(g, i)));
        mx += max(mx, max(max(a, c), max(g, i)));
        vec3 w = sqrt(clamp(min(mn, 2. - mx) / max(mx, 1e-5), 0., 1.)) * peak;   // less sharpening where local contrast is already high
        gl_FragColor = vec4(clamp((b * w + d * w + f * w + h * w + e) / (1. + 4. * w), 0., 1.), 1.);
      }`,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene().add(quad), camera = new THREE.Camera(), size = new THREE.Vector2();
  let frame = null;
  // Call right after the frame is drawn to the canvas (full viewport, no scissor).
  return function apply() {
    renderer.getDrawingBufferSize(size);
    if (!frame || frame.image.width !== size.x || frame.image.height !== size.y) {
      frame?.dispose();
      frame = new THREE.FramebufferTexture(size.x, size.y);
      material.uniforms.map.value = frame;
      material.uniforms.texel.value.set(1 / size.x, 1 / size.y);
    }
    renderer.copyFramebufferToTexture(frame);
    renderer.render(scene, camera);
  };
}
