// Personas (preparadores y repartidores): figura articulada con caderas, rodillas, hombros y codos, ropa de
// trabajo (camiseta, pantalón con bolsillos, chaleco reflectante con bandas, guantes y botas de seguridad) y
// cabeza con gorra, pelo, orejas, nariz y ojos. Mira hacia +x en su espacio local (como los vehículos):
// rotation.y = -yaw. update(anim, t) anima: idle (respira y cambia el peso), walk (camina doblando rodillas y
// codos), crouch (se agacha a por algo), reach (deja algo delante) y pack (empaqueta en la mesa).
// "carrying" pone los brazos por delante y dobla los codos para sujetar la caja por los lados.

import * as THREE from '../vendor/three.module.js';
import { createLabel, disposeSprite } from './textures3d.js';
import { solidMaterial } from './materials3d.js';
import { roundedBoxGeometry } from './geometries3d.js';

const HIP = 6.6;
const THIGH = 3.2;
const SHIN = 2.95;
const UPPER_ARM = 2.3;
const FOREARM = 2.1;
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const PANTS = ['#2d3a4f', '#3b3b3b', '#4a3f35', '#24324a'];
const HAIR = ['#2b1d14', '#4a3222', '#1c1c1c', '#8a6a3a', '#5b4a3a'];
const SHIRTS = ['#3f4a5a', '#5a6470', '#2f3f52', '#6a5a4a'];

// Geometrías compartidas por todas las personas (se crean una vez)
const capsules = new Map();
function capsule(radius, length) {
  const key = `${radius}|${length}`;
  let geometry = capsules.get(key);
  if (!geometry) {
    geometry = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 10);
    capsules.set(key, geometry);
  }
  return geometry;
}
const G = {
  rbox: roundedBoxGeometry(0.22, 2),
  sphere: new THREE.SphereGeometry(0.5, 18, 14),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  capHalf: new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
};

function hashOf(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Figura de una persona. Devuelve { group, anchor, label, update, dispose }. */
export function createCharacter({ id = '', name = '', vest = '#ff8c1a', cap = '#ffb703' } = {}) {
  const h = hashOf(id);
  const skin = solidMaterial(SKINS[h % SKINS.length], 'skin', 'sphere');
  const pants = solidMaterial(PANTS[(h >> 3) % PANTS.length], 'fabric', 'cyl');
  const pantsBox = solidMaterial(PANTS[(h >> 3) % PANTS.length], 'fabric', 'box');
  const shirt = solidMaterial(SHIRTS[(h >> 5) % SHIRTS.length], 'fabric', 'cyl');
  const vestMat = solidMaterial(vest, 'fabric', 'box');
  const vestRound = solidMaterial(vest, 'fabric', 'cyl');
  const stripe = solidMaterial('#dfe6ea', 'reflective', 'box');
  const boots = solidMaterial('#262626', 'rubber', 'box');
  const sole = solidMaterial('#8a6a3a', 'rubber', 'box');
  const gloves = solidMaterial('#3a3f47', 'rubber', 'box');
  const hair = solidMaterial(HAIR[(h >> 7) % HAIR.length], 'fabric', 'sphere');
  const capMat = solidMaterial(cap, 'satin', 'sphere');
  const capBox = solidMaterial(cap, 'satin', 'box');
  const dark = solidMaterial('#1a1a1a', 'gloss', 'sphere');
  const white = solidMaterial('#f4f4f0', 'gloss', 'sphere');

  const part = (geometry, material, x, y, z, sx, sy, sz, parent, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const group = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP;
  group.add(hips);
  part(G.rbox, pantsBox, 0, 0.1, 0, 2.1, 1.5, 3.1, hips); // pelvis
  part(G.rbox, solidMaterial('#2a2a2a', 'satin', 'box'), 0, 0.72, 0, 2.2, 0.3, 3.2, hips); // cinturón
  part(G.rbox, solidMaterial('#c9ced6', 'chrome', 'box'), 1.12, 0.72, 0, 0.12, 0.34, 0.6, hips); // hebilla

  // Piernas: cadera → muslo → rodilla → espinilla → bota
  const legs = [-0.82, 0.82].map((z) => {
    const hip = new THREE.Group();
    hip.position.set(0, -0.2, z);
    hips.add(hip);
    part(capsule(0.68, THIGH + 0.5), pants, 0, -THIGH / 2, 0, 1, 1, 1, hip);
    part(G.rbox, pantsBox, 0.1, -THIGH * 0.45, z > 0 ? 0.62 : -0.62, 0.9, 0.9, 0.18, hip); // bolsillo lateral
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    part(capsule(0.6, SHIN + 0.4), pants, 0, -SHIN / 2, 0, 1, 1, 1, knee);
    const foot = new THREE.Group();
    foot.position.y = -SHIN;
    knee.add(foot);
    part(G.rbox, boots, 0.38, -0.12, 0, 2.3, 0.9, 1.35, foot); // bota con puntera
    part(G.rbox, sole, 0.38, -0.55, 0, 2.4, 0.22, 1.42, foot); // suela
    return { hip, knee };
  });

  // Tronco (se inclina desde la cadera): camiseta, chaleco reflectante, hombros y cuello
  const torso = new THREE.Group();
  torso.position.y = 0.55;
  hips.add(torso);
  part(G.rbox, solidMaterial(SHIRTS[(h >> 5) % SHIRTS.length], 'fabric', 'box'), 0, 1.7, 0, 2.05, 3.6, 3.0, torso); // camiseta
  part(G.rbox, vestMat, 0, 1.95, 0, 2.4, 3.3, 3.45, torso); // chaleco
  part(G.rbox, stripe, 0, 1.15, 0, 2.46, 0.36, 3.52, torso); // bandas reflectantes horizontales
  part(G.rbox, stripe, 0, 2.25, 0, 2.46, 0.36, 3.52, torso);
  for (const z of [-0.85, 0.85]) part(G.rbox, stripe, 1.21, 2.6, z, 0.06, 2.2, 0.32, torso); // tirantes reflectantes
  part(capsule(0.95, 3.6), vestRound, 0, 3.75, 0, 1, 1, 1, torso, Math.PI / 2); // hombros redondeados
  part(G.cyl, skin, 0.05, 4.55, 0, 0.95, 0.9, 0.95, torso); // cuello
  part(G.rbox, solidMaterial('#d9dde2', 'plastic', 'box'), 1.21, 2.8, 0.55, 0.06, 0.55, 0.7, torso); // tarjeta identificativa

  // Cabeza
  const head = new THREE.Group();
  head.position.set(0.05, 5.0, 0);
  torso.add(head);
  part(G.sphere, skin, 0.05, 0.95, 0, 2.25, 2.55, 2.15, head); // cráneo
  part(G.sphere, skin, 0.42, 0.45, 0, 1.45, 1.1, 1.65, head); // mandíbula
  part(G.sphere, skin, 1.16, 0.85, 0, 0.42, 0.5, 0.38, head); // nariz
  for (const z of [-1.08, 1.08]) part(G.sphere, skin, 0.05, 0.95, z, 0.42, 0.62, 0.22, head); // orejas
  for (const z of [-0.42, 0.42]) {
    part(G.sphere, white, 0.98, 1.18, z, 0.3, 0.26, 0.34, head); // ojos
    part(G.sphere, dark, 1.08, 1.18, z, 0.16, 0.18, 0.18, head);
    part(G.rbox, hair, 1.0, 1.5, z, 0.16, 0.12, 0.5, head); // cejas
  }
  part(G.sphere, hair, -0.2, 1.05, 0, 2.2, 2.3, 2.2, head); // pelo (nuca)
  part(G.capHalf, capMat, -0.05, 1.55, 0, 2.42, 1.9, 2.32, head); // gorra
  part(G.rbox, capBox, 1.25, 1.6, 0, 1.5, 0.16, 1.9, head, 0, 0, -0.12); // visera
  part(G.cyl, capMat, -0.05, 2.5, 0, 0.32, 0.12, 0.32, head); // botón

  // Brazos: hombro → brazo → codo → antebrazo → mano con guante
  const arms = [-1.95, 1.95].map((z) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 3.8, z);
    torso.add(shoulder);
    part(capsule(0.56, UPPER_ARM + 0.6), shirt, 0, -UPPER_ARM / 2, 0, 1, 1, 1, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    shoulder.add(elbow);
    part(capsule(0.48, FOREARM + 0.5), skin, 0, -FOREARM / 2, 0, 1, 1, 1, elbow);
    part(G.rbox, gloves, 0.05, -FOREARM - 0.35, 0, 0.75, 1.05, 0.95, elbow); // mano (guante)
    part(G.rbox, gloves, 0.42, -FOREARM - 0.2, z > 0 ? -0.15 : 0.15, 0.3, 0.6, 0.3, elbow); // pulgar
    return { shoulder, elbow, side: Math.sign(z) };
  });

  // Punto donde se colocan los productos o la caja que lleva (delante del pecho)
  const anchor = new THREE.Group();
  anchor.position.set(2.9, 1.0, 0);
  torso.add(anchor);

  const label = createLabel(name, { size: 11, color: '#ffe6b0' });
  label.position.set(0, 18, 0);
  group.add(label);

  const shift = (h % 100) / 100 * Math.PI * 2; // cada persona respira y se balancea a su ritmo
  let blend = 0;
  return {
    group,
    anchor,
    label,
    /** anim: idle | walk | crouch | reach | pack. t: tiempo (s). */
    update(anim, t, { carrying = false, speed = 0, dt = 0.016 } = {}) {
      const walking = anim === 'walk';
      blend += ((walking ? 1 : 0) - blend) * Math.min(1, dt * 10);
      const phase = t * (6 + Math.min(4, speed / 12));
      const swing = Math.sin(phase) * 0.6 * blend;
      const lift = (k) => Math.max(0, Math.sin(phase + k)) * blend;
      let hipY = HIP + Math.abs(Math.cos(phase)) * 0.22 * blend - 0.08 * blend;
      let lean = -0.05 * blend;
      let twist = Math.sin(phase) * 0.07 * blend;
      const leg = [
        { hip: swing, knee: -lift(Math.PI * 0.5) * 0.95, foot: lift(Math.PI * 0.5) * 0.3 },
        { hip: -swing, knee: -lift(Math.PI * 1.5) * 0.95, foot: lift(Math.PI * 1.5) * 0.3 },
      ];
      const arm = [
        { shoulder: -swing * 0.75, out: 0.06, elbow: 0.25 + Math.max(0, -swing) * 0.4 },
        { shoulder: swing * 0.75, out: 0.06, elbow: 0.25 + Math.max(0, swing) * 0.4 },
      ];
      let headTilt = 0;

      if (anim === 'idle') {
        const breathe = Math.sin(t * 2.1 + shift) * 0.03;
        const weight = Math.sin(t * 0.45 + shift) * 0.05;
        arm[0].shoulder = 0.05 + breathe;
        arm[1].shoulder = 0.05 - breathe;
        arm[0].elbow = 0.18;
        arm[1].elbow = 0.18;
        leg[0].hip = weight;
        leg[1].hip = -weight;
        leg[0].knee = -Math.max(0, weight) * 0.6;
        leg[1].knee = -Math.max(0, -weight) * 0.6;
        lean = breathe * 0.5;
        twist = weight * 0.4;
        headTilt = Math.sin(t * 0.7 + shift) * 0.06;
      } else if (anim === 'crouch') {
        const k = Math.min(1, t / 0.3);
        hipY = HIP - 2.6 * k;
        for (const l of leg) { l.hip = 1.25 * k; l.knee = -1.9 * k; l.foot = 0.65 * k; }
        lean = -0.6 * k;
        for (const a of arm) { a.shoulder = 0.9 * k; a.elbow = 0.3; a.out = 0.12; }
        headTilt = -0.2 * k;
      } else if (anim === 'reach') {
        lean = -0.22;
        for (const a of arm) { a.shoulder = 1.3 + Math.sin(t * 5) * 0.08; a.elbow = 0.25; a.out = 0.08; }
        headTilt = -0.25;
      } else if (anim === 'pack') {
        lean = -0.2;
        arm[0].shoulder = 0.95 + Math.sin(t * 8) * 0.25;
        arm[1].shoulder = 0.95 - Math.sin(t * 8) * 0.25;
        arm[0].elbow = 0.9 + Math.cos(t * 8) * 0.2;
        arm[1].elbow = 0.9 - Math.cos(t * 8) * 0.2;
        headTilt = -0.35;
      }
      if (carrying && anim !== 'crouch') {
        // La caja va delante del pecho: brazos adelante, codos doblados y manos a los lados
        for (const a of arm) { a.shoulder = 0.95; a.elbow = 0.85; a.out = 0.28; }
        lean = Math.max(lean, -0.04) + 0.04;
        twist *= 0.3;
      }

      hips.position.y = hipY;
      torso.rotation.set(0, twist, lean);
      head.rotation.z = headTilt;
      for (let i = 0; i < 2; i++) {
        legs[i].hip.rotation.z = leg[i].hip;
        legs[i].knee.rotation.z = leg[i].knee;
        legs[i].knee.children[1].rotation.z = leg[i].foot; // el pie compensa la rodilla
        arms[i].shoulder.rotation.set(-arms[i].side * arm[i].out, 0, arm[i].shoulder); // "out" separa el brazo del cuerpo
        arms[i].elbow.rotation.z = arm[i].elbow;
      }
    },
    dispose() {
      disposeSprite(label);
    },
  };
}
