// Personas del almacén (preparadores): figura humana sencilla con piernas y brazos articulados, chaleco
// reflectante y gorra. Mira hacia +x en su espacio local (como los vehículos): rotation.y = -yaw.
// update(anim, t) anima: idle (respira), walk (camina), crouch (se agacha a por algo), reach (deja algo
// delante) y pack (empaqueta en la mesa). "carrying" pone los brazos por delante para llevar cosas.

import * as THREE from '../vendor/three.module.js';
import { createLabel, disposeSprite } from './textures3d.js';
import { GEOMETRIES } from './products3d.js';

const HIP = 6.6;
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const PANTS = ['#2d3a4f', '#3b3b3b', '#4a3f35', '#24324a'];

const shared = new Map();
function mat(color) {
  let m = shared.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); shared.set(color, m); }
  return m;
}

function hashOf(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Figura de una persona. Devuelve { group, anchor, label, update, dispose }. */
export function createCharacter({ id = '', name = '', vest = '#ff8c1a', cap = '#ffb703' } = {}) {
  const h = hashOf(id);
  const skin = mat(SKINS[h % SKINS.length]);
  const pants = mat(PANTS[(h >> 3) % PANTS.length]);
  const vestMat = mat(vest);
  const stripe = mat('#e8eef2');
  const shirt = mat('#f4f1ea');
  const shoe = mat('#1f1f1f');
  const capMat = mat(cap);

  const part = (kind, material, x, y, z, sx, sy, sz, parent) => {
    const mesh = new THREE.Mesh(GEOMETRIES[kind], material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const group = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP;
  group.add(hips);

  // Piernas (pivotan en la cadera)
  const legs = [-0.85, 0.85].map((z) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, z);
    part('box', pants, 0, -3.1, 0, 1.4, 6.2, 1.4, pivot);
    part('box', shoe, 0.4, -6.3, 0, 2.2, 0.7, 1.4, pivot);
    hips.add(pivot);
    return pivot;
  });

  // Tronco (se inclina desde la cadera)
  const torso = new THREE.Group();
  hips.add(torso);
  part('box', pants, 0, 0.3, 0, 2.0, 1.2, 3.2, torso); // cintura
  part('box', vestMat, 0, 2.6, 0, 2.3, 4.0, 3.4, torso); // chaleco
  part('box', stripe, 0, 1.8, 0, 2.36, 0.4, 3.46, torso); // bandas reflectantes
  part('box', stripe, 0, 3.0, 0, 2.36, 0.4, 3.46, torso);
  part('box', shirt, 0, 4.75, 0, 1.6, 0.5, 2.4, torso); // cuello
  part('sphere', skin, 0, 6.2, 0, 2.5, 2.7, 2.5, torso); // cabeza
  part('cyl', capMat, -0.1, 7.25, 0, 2.7, 0.8, 2.7, torso); // gorra
  part('box', capMat, 1.4, 6.95, 0, 1.6, 0.25, 2.2, torso); // visera
  part('box', mat('#1f1f1f'), 1.17, 6.3, 0.48, 0.1, 0.3, 0.3, torso); // ojos
  part('box', mat('#1f1f1f'), 1.17, 6.3, -0.48, 0.1, 0.3, 0.3, torso);

  // Brazos (pivotan en el hombro)
  const arms = [-2.15, 2.15].map((z) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, 4.2, z);
    part('box', vestMat, 0, -0.9, 0, 1.0, 1.8, 1.0, pivot);
    part('box', shirt, 0, -2.6, 0, 0.9, 1.8, 0.9, pivot);
    part('sphere', skin, 0, -3.7, 0, 1.0, 1.0, 1.0, pivot);
    torso.add(pivot);
    return pivot;
  });

  // Punto donde se colocan los productos o la caja que lleva (delante del pecho)
  const anchor = new THREE.Group();
  anchor.position.set(2.9, 1.0, 0);
  torso.add(anchor);

  const label = createLabel(name, { size: 11, color: '#ffe6b0' });
  label.position.set(0, 18, 0);
  group.add(label);

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
      const swing = Math.sin(phase) * 0.65 * blend;
      let hipY = HIP + Math.abs(Math.cos(phase)) * 0.25 * blend;
      let lean = 0;
      let legL = swing;
      let legR = -swing;
      let armL = -swing * 0.8;
      let armR = swing * 0.8;

      if (anim === 'idle') {
        const breathe = Math.sin(t * 2.1) * 0.03;
        armL = 0.05 + breathe;
        armR = 0.05 - breathe;
        lean = breathe * 0.5;
      } else if (anim === 'crouch') {
        const k = Math.min(1, t / 0.3);
        hipY = HIP - 2.4 * k;
        legL = legR = 0.9 * k;
        lean = -0.55 * k;
        armL = armR = 0.6 * k;
      } else if (anim === 'reach') {
        lean = -0.2;
        armL = armR = 1.35 + Math.sin(t * 5) * 0.08;
      } else if (anim === 'pack') {
        lean = -0.18;
        armL = 1.0 + Math.sin(t * 8) * 0.28;
        armR = 1.0 - Math.sin(t * 8) * 0.28;
      }
      if (carrying && anim !== 'crouch') {
        armL = armR = 1.25;
        lean = Math.max(lean, -0.05);
      }

      hips.position.y = hipY;
      torso.rotation.z = lean;
      legs[0].rotation.z = legL;
      legs[1].rotation.z = legR;
      arms[0].rotation.z = armL;
      arms[1].rotation.z = armR;
    },
    dispose() {
      disposeSprite(label);
    },
  };
}
