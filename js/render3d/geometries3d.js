// Geometrías base reutilizables con cantos redondeados y perfiles torneados (sin complementos de Three.js).
// Todas son unitarias (caben en un cubo de 1 centrado en el origen) para usarlas escaladas o instanciadas.

import * as THREE from '../vendor/three.module.js';

/**
 * Caja de 1×1×1 con aristas redondeadas (radio relativo "radius") y normales suaves en los cantos.
 * Las UV de cada cara van de 0 a 1 sobre la cara completa (la franja redondeada queda en los bordes).
 */
export function roundedBoxGeometry(radius = 0.12, steps = 2) {
  const segments = steps * 2 + 1;
  const geometry = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const half = 0.5 - radius;
  const halfSegment = 0.5 / segments;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const perFace = (segments + 1) * (segments + 1);
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    n.set(
      p.x - Math.sign(p.x) * halfSegment,
      p.y - Math.sign(p.y) * halfSegment,
      p.z - Math.sign(p.z) * halfSegment,
    ).normalize();
    const x = half * Math.sign(p.x) + n.x * radius;
    const y = half * Math.sign(p.y) + n.y * radius;
    const z = half * Math.sign(p.z) + n.z * radius;
    position.setXYZ(i, x, y, z);
    normal.setXYZ(i, n.x, n.y, n.z);
    // UV planas por cara (orden de BoxGeometry: +x, -x, +y, -y, +z, -z)
    switch (Math.floor(i / perFace)) {
      case 0: uv.setXY(i, 0.5 - z, y + 0.5); break;
      case 1: uv.setXY(i, z + 0.5, y + 0.5); break;
      case 2: uv.setXY(i, x + 0.5, 0.5 - z); break;
      case 3: uv.setXY(i, x + 0.5, z + 0.5); break;
      case 4: uv.setXY(i, x + 0.5, y + 0.5); break;
      default: uv.setXY(i, 0.5 - x, y + 0.5); break;
    }
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** Arco de un cuarto de círculo de (cx, cy) con radio r entre los ángulos a0 y a1 (en puntos Vector2). */
function arc(points, cx, cy, r, a0, a1, steps = 4) {
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    points.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
}

/** Cilindro de diámetro 1 y altura 1 (centrado) con los bordes de las tapas redondeados. */
export function roundedCylinderGeometry(bevel = 0.1, radial = 20) {
  const r = 0.5;
  const h = 0.5;
  const points = [new THREE.Vector2(0, -h), new THREE.Vector2(r - bevel, -h)];
  arc(points, r - bevel, -h + bevel, bevel, -Math.PI / 2, 0);
  points.push(new THREE.Vector2(r, h - bevel));
  arc(points, r - bevel, h - bevel, bevel, 0, Math.PI / 2);
  points.push(new THREE.Vector2(0, h));
  const geometry = new THREE.LatheGeometry(points, radial);
  geometry.computeVertexNormals();
  return geometry;
}

/** Perfil torneado normalizado a diámetro 1 y altura 1 (centrado). profile = [[radio 0..0.5, y 0..1], ...]. */
export function latheGeometry(profile, radial = 20) {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y - 0.5));
  const geometry = new THREE.LatheGeometry(points, radial);
  geometry.computeVertexNormals();
  return geometry;
}

/** Botella: base, cuerpo, hombro redondeado, cuello y boca. */
export const bottleGeometry = () => latheGeometry([
  [0, 0], [0.44, 0], [0.5, 0.03], [0.5, 0.58], [0.46, 0.66], [0.34, 0.74], [0.2, 0.8], [0.16, 0.84], [0.16, 0.96], [0.19, 0.97], [0.18, 1], [0, 1],
], 22);

/** Jarrón: panza, cintura, cuello y boca abierta. */
export const vaseGeometry = () => latheGeometry([
  [0, 0], [0.26, 0], [0.3, 0.04], [0.44, 0.2], [0.5, 0.36], [0.46, 0.52], [0.3, 0.68], [0.2, 0.78], [0.2, 0.88], [0.28, 0.98], [0.3, 1], [0, 1],
], 22);

/** Neumático: perfil redondeado (toroide achatado), diámetro 1, ancho 1 a lo largo de y. */
export function tireGeometry(inner = 0.32, radial = 28) {
  const points = [];
  const outer = 0.5;
  const mid = (outer + inner) / 2;
  const rr = (outer - inner) / 2;
  // Banda de rodadura casi plana con hombros redondeados y flancos algo abombados
  points.push(new THREE.Vector2(inner, -0.42));
  points.push(new THREE.Vector2(mid, -0.5));
  points.push(new THREE.Vector2(outer - rr * 0.35, -0.48));
  arc(points, outer - rr * 0.35, -0.48 + rr * 0.35, rr * 0.35, -Math.PI / 2, 0, 3);
  points.push(new THREE.Vector2(outer, 0.48 - rr * 0.35));
  arc(points, outer - rr * 0.35, 0.48 - rr * 0.35, rr * 0.35, 0, Math.PI / 2, 3);
  points.push(new THREE.Vector2(mid, 0.5));
  points.push(new THREE.Vector2(inner, 0.42));
  const geometry = new THREE.LatheGeometry(points, radial);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Copa de árbol: varias esferas deformadas con ruido y fusionadas en una sola geometría (con color por
 * vértice: más claro arriba y en el exterior, más oscuro abajo). Unitaria (radio ≈ 1).
 */
export function crownGeometry(seed = 1, lobes = 5, detail = 1) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const parts = [];
  const centers = [[0, 0.05, 0, 0.82]];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rnd() * 0.6;
    const ring = 0.42 + rnd() * 0.18;
    centers.push([Math.cos(a) * ring, -0.12 + rnd() * 0.42, Math.sin(a) * ring, 0.5 + rnd() * 0.2]);
  }
  centers.push([0.05, 0.48, -0.04, 0.5]);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const [cx, cy, cz, r] of centers) {
    const base = new THREE.IcosahedronGeometry(r, detail);
    const g = base.index ? base.toNonIndexed() : base;
    if (g !== base) base.dispose();
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Normal suave hacia fuera del lóbulo (follaje mullido, sin facetas marcadas)
      n.copy(v).normalize();
      // Bultos: desplaza cada vértice a lo largo de su dirección con un ruido barato y estable
      const k = 1 + (Math.sin(v.x * 9.1 + seed) * Math.sin(v.y * 7.3) * Math.sin(v.z * 8.7 + seed * 0.5)) * 0.16;
      v.multiplyScalar(k);
      pos.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
      nor.setXYZ(i, n.x, n.y, n.z);
      const height = Math.min(1, Math.max(0, (v.y + cy + 0.9) / 1.8));
      const tone = 0.62 + height * 0.42;
      colors[i * 3] = tone;
      colors[i * 3 + 1] = tone;
      colors[i * 3 + 2] = tone;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** Copa de conífera: tres conos apilados ligeramente irregulares (radio 1, altura 2, base en y = 0). */
export function coniferGeometry(seed = 1) {
  const parts = [];
  const tiers = [[1, 0, 1.0], [0.78, 0.55, 0.85], [0.52, 1.05, 0.75]];
  for (const [r, y, h] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 9, 2);
    const g = cone.toNonIndexed(); // conserva las normales suaves del cono
    cone.dispose();
    g.translate(0, y + h / 2, 0);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const wobble = 1 + Math.sin(Math.atan2(v.z, v.x) * 5 + seed + y * 3) * 0.06;
      pos.setXYZ(i, v.x * wobble, v.y, v.z * wobble);
      const tone = 0.6 + Math.min(1, v.y / 2) * 0.4;
      colors[i * 3] = tone;
      colors[i * 3 + 1] = tone;
      colors[i * 3 + 2] = tone;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/**
 * Fusiona geometrías no indexadas con los mismos atributos (position, normal y opcionalmente uv y color).
 * Devuelve una geometría nueva y libera las de entrada.
 */
export function mergeGeometries(list) {
  const names = ['position', 'normal', 'uv', 'color'].filter((name) => list.every((g) => g.attributes[name]));
  let total = 0;
  const sources = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of sources) total += g.attributes.position.count;
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const size = sources[0].attributes[name].itemSize;
    const array = new Float32Array(total * size);
    let offset = 0;
    for (const g of sources) {
      array.set(g.attributes[name].array, offset);
      offset += g.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  for (const g of list) g.dispose();
  for (const g of sources) if (!list.includes(g)) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}
