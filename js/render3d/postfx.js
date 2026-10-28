// Post-procesado propio (sin dependencias extra): la escena se pinta en un búfer HDR con antialiasing
// y después se le aplica brillo (bloom) en las zonas luminosas, mapeo de tonos ACES, corrección de color
// según la hora del día, viñeta y un grano muy suave. Las etiquetas y pines se pintan después, sin filtros.

import * as THREE from '../vendor/three.module.js';

const QUAD_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAGMENT = `
uniform sampler2D tInput;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.45, l), 1.0);
}`;

// Desenfoque gaussiano separable de 9 muestras (dirección en píxeles de textura)
const BLUR_FRAGMENT = `
uniform sampler2D tInput;
uniform vec2 direction;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tInput, vUv).rgb * 0.2270270270;
  sum += texture2D(tInput, vUv + direction * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tInput, vUv - direction * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tInput, vUv + direction * 3.2307692308).rgb * 0.0702702703;
  sum += texture2D(tInput, vUv - direction * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float bloomStrength;
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform vec3 tint;
uniform float vignette;
uniform float grain;
uniform float time;
uniform vec2 resolution;
varying vec2 vUv;

vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 color = texture2D(tScene, vUv).rgb;
  vec3 glow = texture2D(tBloomA, vUv).rgb * 0.6 + texture2D(tBloomB, vUv).rgb * 0.9;
  color += glow * bloomStrength;
  color = acesFilm(color * exposure);
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(l), color, saturation);
  color = (color - 0.5) * contrast + 0.5;
  color *= tint;
  vec2 d = vUv - 0.5;
  d.x *= resolution.x / resolution.y;
  color *= mix(1.0 - vignette, 1.0, smoothstep(0.95, 0.3, length(d)));
  color += (hash(vUv * resolution + fract(time) * 61.0) - 0.5) * grain;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  #include <colorspace_fragment>
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.bloomEnabled = true;
    // Búfer HDR si la tarjeta lo permite (si no, de 8 bits: el brillo funciona igual, con menos rango)
    const extensions = renderer.extensions;
    const hdr = renderer.capabilities.isWebGL2
      && (extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float'));
    this.type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const samples = renderer.capabilities.isWebGL2 ? 4 : 0;
    const options = { type: this.type, depthBuffer: false };
    this.sceneTarget = new THREE.WebGLRenderTarget(4, 4, { type: this.type, samples, depthBuffer: true });
    this.half = [new THREE.WebGLRenderTarget(4, 4, options), new THREE.WebGLRenderTarget(4, 4, options)];
    this.quarter = [new THREE.WebGLRenderTarget(4, 4, options), new THREE.WebGLRenderTarget(4, 4, options)];

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.brightMaterial = material(BRIGHT_FRAGMENT, { tInput: { value: null }, threshold: { value: 0.9 } });
    this.blurMaterial = material(BLUR_FRAGMENT, { tInput: { value: null }, direction: { value: new THREE.Vector2() } });
    this.compositeMaterial = material(COMPOSITE_FRAGMENT, {
      tScene: { value: null },
      tBloomA: { value: null },
      tBloomB: { value: null },
      bloomStrength: { value: 0.8 },
      exposure: { value: 1 },
      saturation: { value: 1.12 },
      contrast: { value: 1.05 },
      tint: { value: new THREE.Vector3(1, 1, 1) },
      vignette: { value: 0.28 },
      grain: { value: 0.018 },
      time: { value: 0 },
      resolution: { value: new THREE.Vector2(1, 1) },
    });
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.sceneTarget.setSize(w, h);
    for (const t of this.half) t.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    for (const t of this.quarter) t.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.compositeMaterial.uniforms.resolution.value.set(w, h);
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.camera);
  }

  blur(source, temp, target) {
    const u = this.blurMaterial.uniforms;
    u.tInput.value = source.texture;
    u.direction.value.set(1 / source.width, 0);
    this.pass(this.blurMaterial, temp);
    u.tInput.value = temp.texture;
    u.direction.value.set(0, 1 / temp.height);
    this.pass(this.blurMaterial, target);
  }

  /** grading = { exposure, saturation, contrast, tint: [r, g, b], vignette, bloomStrength, bloomThreshold, time } */
  render(scene, camera, grading) {
    const { renderer } = this;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    const c = this.compositeMaterial.uniforms;
    if (this.bloomEnabled) {
      this.brightMaterial.uniforms.tInput.value = this.sceneTarget.texture;
      this.brightMaterial.uniforms.threshold.value = grading.bloomThreshold;
      this.pass(this.brightMaterial, this.half[0]);
      this.blur(this.half[0], this.half[1], this.half[0]);
      this.blur(this.half[0], this.quarter[1], this.quarter[0]);
      this.blur(this.quarter[0], this.quarter[1], this.quarter[0]);
      c.tBloomA.value = this.half[0].texture;
      c.tBloomB.value = this.quarter[0].texture;
      c.bloomStrength.value = grading.bloomStrength;
    } else {
      // Sin brillo: se reutiliza la propia escena y se multiplica por cero
      c.tBloomA.value = this.sceneTarget.texture;
      c.tBloomB.value = this.sceneTarget.texture;
      c.bloomStrength.value = 0;
    }
    c.tScene.value = this.sceneTarget.texture;
    c.exposure.value = grading.exposure;
    c.saturation.value = grading.saturation;
    c.contrast.value = grading.contrast;
    c.tint.value.set(grading.tint[0], grading.tint[1], grading.tint[2]);
    c.vignette.value = grading.vignette;
    c.time.value = grading.time;
    this.pass(this.compositeMaterial, previous);
  }

  dispose() {
    for (const t of [this.sceneTarget, ...this.half, ...this.quarter]) t.dispose();
    this.quad.geometry.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}
