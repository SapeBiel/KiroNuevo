// Efectos del modo 3D: confeti, humo, chispas, cifras flotantes, ondas y cajas voladoras.

import * as THREE from '../vendor/three.module.js';
import { createLabel, disposeSprite, scaleSpriteToScreen } from './textures3d.js';

const CONFETTI_COLORS = ['#ffb703', '#fb8500', '#4cc9f0', '#90be6d', '#f72585', '#ffffff'];
const MAX_CONFETTI = 500;
const MAX_SOFT = 320;
const MAX_SKIDS = 360;
const SKID_LIFE = 5;

const POINT_VERTEX = `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAGMENT = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Nube de puntos redondos y suaves con color, tamaño y transparencia por partícula. */
class SoftPoints {
  constructor(max, additive) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 4);
    this.sizes = new Float32Array(max);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Vuelca la lista de partículas {x,y,z,color:[r,g,b],alpha,size} a los buffers. */
  write(list) {
    const count = Math.min(list.length, this.max);
    for (let i = 0; i < count; i++) {
      const p = list[i];
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 4] = p.color[0];
      this.colors[i * 4 + 1] = p.color[1];
      this.colors[i * 4 + 2] = p.color[2];
      this.colors[i * 4 + 3] = p.alpha;
      this.sizes[i] = p.size;
    }
    this.geometry.setDrawRange(0, count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class Effects3D {
  constructor() {
    this.group = new THREE.Group();
    this.shake = 0;

    this.confetti = [];
    this.smoke = [];
    this.sparks = [];
    this.texts = [];
    this.rings = [];
    this.boxes = [];

    this.confettiGeometry = new THREE.PlaneGeometry(1, 0.5);
    this.confettiMesh = new THREE.InstancedMesh(this.confettiGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), MAX_CONFETTI);
    this.confettiMesh.count = 0;
    this.confettiMesh.frustumCulled = false;
    this.confettiMesh.setColorAt(0, new THREE.Color('#ffffff'));
    this.group.add(this.confettiMesh);

    this.smokeCloud = new SoftPoints(MAX_SOFT, false);
    this.sparkCloud = new SoftPoints(MAX_SOFT, true);
    this.group.add(this.smokeCloud.points, this.sparkCloud.points);

    // Marcas de neumático: tiras planas sobre el suelo (anillo circular de instancias)
    this.skids = [];
    this.skidGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.skidMaterial = new THREE.MeshBasicMaterial({
      color: '#121418', transparent: true, opacity: 0.45, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.skidMesh = new THREE.InstancedMesh(this.skidGeometry, this.skidMaterial, MAX_SKIDS);
    this.skidMesh.count = 0;
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 1;
    this.group.add(this.skidMesh);

    this.ringGeometry = new THREE.RingGeometry(0.88, 1, 56).rotateX(-Math.PI / 2);
    this.boxGeometry = new THREE.BoxGeometry(7, 7, 7);
    this.boxMaterial = new THREE.MeshLambertMaterial({ color: '#c99a62', emissive: '#3a2a14' });
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
  }

  // ----------------------------------------------------------- Creación ----

  addConfetti(x, z, count = 26, power = 1) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (50 + Math.random() * 130) * power;
      if (this.confetti.length >= MAX_CONFETTI) this.confetti.shift();
      this.confetti.push({
        x, y: 8 + Math.random() * 6, z,
        vx: Math.cos(angle) * speed, vy: (150 + Math.random() * 190) * Math.min(1.4, power), vz: Math.sin(angle) * speed,
        rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
        sx: (Math.random() - 0.5) * 16, sy: (Math.random() - 0.5) * 16, sz: (Math.random() - 0.5) * 16,
        size: 3.4 + Math.random() * 3.6, life: 1.1 + Math.random() * 0.9, age: 0,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }
  }

  addSmoke(x, z, vx = 0, vz = 0) {
    if (this.smoke.length >= MAX_SOFT) this.smoke.shift();
    this.smoke.push({
      x, y: 6, z, vx: vx + (Math.random() - 0.5) * 8, vy: 10 + Math.random() * 8, vz: vz + (Math.random() - 0.5) * 8,
      life: 0.9, age: 0, size: 5 + Math.random() * 3,
    });
  }

  addSparks(x, z, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 150;
      if (this.sparks.length >= MAX_SOFT) this.sparks.shift();
      this.sparks.push({
        x, y: 8, z, vx: Math.cos(angle) * speed, vy: 40 + Math.random() * 120, vz: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.25, age: 0, size: 3.2,
      });
    }
  }

  addText(x, z, text, { color = '#7CFC9A', size = 22, life = 1.5, rise = 46, y = 28 } = {}) {
    const sprite = createLabel(text, { size, color, weight: '800' });
    sprite.position.set(x, y, z);
    this.group.add(sprite);
    this.texts.push({ sprite, vy: rise, life, age: 0 });
  }

  addRing(x, z, color = '#ffffff', radius = 120) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.position.set(x, 1.6, z);
    mesh.scale.setScalar(radius * 0.2);
    this.group.add(mesh);
    this.rings.push({ mesh, radius, life: 0.9, age: 0 });
  }

  /** Caja que vuela desde un punto hasta un objetivo móvil (la furgoneta). */
  addBox(fromX, fromZ, getTarget, delay = 0) {
    const mesh = new THREE.Mesh(this.boxGeometry, this.boxMaterial);
    mesh.visible = false;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.boxes.push({ mesh, fromX, fromZ, getTarget, delay, life: 0.6, age: 0 });
  }

  /** Tramo de marca de neumático entre dos puntos del suelo (coordenadas x/z). */
  addSkid(x1, z1, x2, z2) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.5) return;
    if (this.skids.length >= MAX_SKIDS) this.skids.shift();
    this.skids.push({ x: (x1 + x2) / 2, z: (z1 + z2) / 2, angle: Math.atan2(z2 - z1, x2 - x1), length: length + 1.5, age: 0 });
  }

  addShake(amount) {
    this.shake = Math.min(10, this.shake + amount);
  }

  // --------------------------------------------------------- Simulación ----

  update(dt, camera, viewHeight, pixelRatio) {
    this.shake = Math.max(0, this.shake - dt * 18);
    const fov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 2;
    const uScale = (viewHeight * pixelRatio) / fov;
    this.smokeCloud.material.uniforms.uScale.value = uScale;
    this.sparkCloud.material.uniforms.uScale.value = uScale;

    this.updateSkids(dt);
    this.updateConfetti(dt);
    this.updateSmoke(dt);
    this.updateSparks(dt);
    this.updateTexts(dt, camera, viewHeight);
    this.updateRings(dt);
    this.updateBoxes(dt);
  }

  /** Las marcas se van estrechando hasta desaparecer (el material es común, así que no se puede variar la opacidad). */
  updateSkids(dt) {
    const { dummy, skidMesh } = this;
    this.skids = this.skids.filter((s) => (s.age += dt) < SKID_LIFE);
    this.skids.forEach((s, i) => {
      const t = s.age / SKID_LIFE;
      dummy.position.set(s.x, 0.7, s.z);
      dummy.rotation.set(0, -s.angle, 0);
      dummy.scale.set(s.length, 1, 3.2 * (1 - t * t));
      dummy.updateMatrix();
      skidMesh.setMatrixAt(i, dummy.matrix);
    });
    skidMesh.count = this.skids.length;
    skidMesh.instanceMatrix.needsUpdate = true;
  }

  updateConfetti(dt) {
    const { dummy, tmpColor, confettiMesh } = this;
    let alive = 0;
    const next = [];
    for (const p of this.confetti) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= 380 * dt;
      const drag = Math.max(0, 1 - 0.9 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.8) {
        p.y = 0.8;
        p.vy = 0;
        p.vx *= 0.5;
        p.vz *= 0.5;
      } else {
        p.rx += p.sx * dt;
        p.ry += p.sy * dt;
        p.rz += p.sz * dt;
      }
      const fadeStart = p.life * 0.75;
      const scale = p.age > fadeStart ? 1 - (p.age - fadeStart) / (p.life - fadeStart) : 1;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.setScalar(p.size * scale);
      dummy.updateMatrix();
      confettiMesh.setMatrixAt(alive, dummy.matrix);
      tmpColor.set(p.color);
      confettiMesh.setColorAt(alive, tmpColor);
      alive += 1;
      next.push(p);
    }
    this.confetti = next;
    confettiMesh.count = alive;
    confettiMesh.instanceMatrix.needsUpdate = true;
    if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;
  }

  updateSmoke(dt) {
    const list = [];
    const color = rgb('#d2d7e1');
    this.smoke = this.smoke.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      list.push({ x: p.x, y: p.y, z: p.z, color, alpha: 0.34 * (1 - t), size: p.size + t * 12 });
      return true;
    });
    this.smokeCloud.write(list);
  }

  updateSparks(dt) {
    const list = [];
    const color = rgb('#ffd166');
    this.sparks = this.sparks.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) return false;
      p.vy -= 320 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.5, p.y + p.vy * dt);
      p.z += p.vz * dt;
      list.push({ x: p.x, y: p.y, z: p.z, color, alpha: 1 - p.age / p.life, size: p.size });
      return true;
    });
    this.sparkCloud.write(list);
  }

  updateTexts(dt, camera, viewHeight) {
    this.texts = this.texts.filter((t) => {
      t.age += dt;
      if (t.age >= t.life) {
        this.group.remove(t.sprite);
        disposeSprite(t.sprite);
        return false;
      }
      t.vy *= Math.max(0, 1 - 1.2 * dt);
      t.sprite.position.y += t.vy * dt;
      const progress = t.age / t.life;
      t.sprite.material.opacity = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
      scaleSpriteToScreen(t.sprite, camera, viewHeight, t.sprite.userData.label.pxHeight);
      return true;
    });
  }

  updateRings(dt) {
    this.rings = this.rings.filter((r) => {
      r.age += dt;
      if (r.age >= r.life) {
        this.group.remove(r.mesh);
        r.mesh.material.dispose();
        return false;
      }
      const t = r.age / r.life;
      r.mesh.scale.setScalar(r.radius * (0.2 + 0.8 * t));
      r.mesh.material.opacity = 0.8 * (1 - t);
      return true;
    });
  }

  updateBoxes(dt) {
    this.boxes = this.boxes.filter((b) => {
      if (b.delay > 0) {
        b.delay -= dt;
        return true;
      }
      b.age += dt;
      if (b.age >= b.life) {
        this.group.remove(b.mesh);
        return false;
      }
      b.mesh.visible = true;
      const t = b.age / b.life;
      const ease = t * t * (3 - 2 * t);
      const target = b.getTarget();
      b.mesh.position.set(
        b.fromX + (target.x - b.fromX) * ease,
        14 + 10 * ease + Math.sin(t * Math.PI) * 38,
        b.fromZ + (target.z - b.fromZ) * ease,
      );
      b.mesh.rotation.y = t * 5;
      return true;
    });
  }

  clear() {
    this.skids = [];
    this.skidMesh.count = 0;
    this.confetti = [];
    this.smoke = [];
    this.sparks = [];
    for (const t of this.texts) { this.group.remove(t.sprite); disposeSprite(t.sprite); }
    for (const r of this.rings) { this.group.remove(r.mesh); r.mesh.material.dispose(); }
    for (const b of this.boxes) this.group.remove(b.mesh);
    this.texts = [];
    this.rings = [];
    this.boxes = [];
  }

  dispose() {
    this.clear();
    this.skidGeometry.dispose();
    this.skidMaterial.dispose();
    this.skidMesh.dispose();
    this.confettiGeometry.dispose();
    this.confettiMesh.material.dispose();
    this.confettiMesh.dispose();
    this.smokeCloud.dispose();
    this.sparkCloud.dispose();
    this.ringGeometry.dispose();
    this.boxGeometry.dispose();
    this.boxMaterial.dispose();
  }
}
