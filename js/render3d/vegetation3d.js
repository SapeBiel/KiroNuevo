// Árboles instanciados (parques de la ciudad y de las afueras): copas irregulares de varios lóbulos y coníferas
// de pisos, tronco con corteza, raíces y ramas. Unas pocas mallas instanciadas para cualquier número de árboles.
// Las copas ocupan el mismo radio "r" que usa la colisión del árbol (no cambia lo que se puede atravesar).

import * as THREE from '../vendor/three.module.js';
import { coniferGeometry, crownGeometry, mergeGeometries } from './geometries3d.js';
import { barkTexture } from './materials3d.js';

const LEAF_COLORS = ['#3f8f4c', '#4a9b52', '#5aa65a', '#3a8045', '#6aae5d', '#7aa64c'];
const CONIFER_COLORS = ['#2f6b45', '#356f48', '#2b5e3f', '#3b7a4e'];
const CROWN_VARIANTS = 3;

/** Hash estable 0..1 a partir de un número entero (para variar árboles sin tocar la semilla del mapa). */
function hash01(n) {
  let t = (n * 2654435761) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 2246822519) >>> 0;
  t ^= t >>> 13;
  return (t >>> 0) / 4294967296;
}

/** Cilindro abierto (sin tapas) con la base en y = 0, radio r0 abajo y r1 arriba, UV de corteza repetidas. */
function limb(r0, r1, length, repeatV) {
  const geometry = new THREE.CylinderGeometry(r1, r0, length, 8, 2, true).toNonIndexed();
  geometry.translate(0, length / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * repeatV);
  return geometry;
}

/**
 * Tronco unitario (base en y = 0, altura 1, radio ≈ 1 en la base): ensanchamiento de raíces, fuste algo
 * cónico y tres ramas que se meten en la copa. Se escala por instancia (x/z = grosor, y = altura).
 */
function trunkGeometry() {
  const parts = [];
  // Raíces: cono bajo y ancho que se hunde un poco en el césped
  const flare = new THREE.LatheGeometry(
    [[1.55, -0.04], [1.25, 0.02], [1.02, 0.08], [0.92, 0.16]].map(([r, y]) => new THREE.Vector2(r, y)), 8,
  ).toNonIndexed();
  parts.push(flare);
  parts.push(limb(0.92, 0.6, 0.92, 3).translate(0, 0.14, 0));
  // Ramas inclinadas hacia fuera desde el último tercio del tronco
  for (let i = 0; i < 3; i++) {
    const branch = limb(0.36, 0.16, 0.42, 1);
    branch.rotateZ(0.75 + i * 0.12);
    branch.rotateY(i * 2.1 + 0.4);
    branch.translate(0, 0.66 + i * 0.09, 0);
    parts.push(branch);
  }
  // (las normales suaves de las geometrías originales se conservan al pasar a no indexadas)
  return mergeGeometries(parts);
}

/**
 * Crea las mallas de una lista de árboles [{x, z, r}] con la base a la altura "baseY".
 * Devuelve { meshes, dispose }.
 */
export function buildTreeMeshes(trees, baseY = 0, { detail = 1 } = {}) {
  if (!trees.length) return { meshes: [], dispose() {} };
  // detail 1 ≈ 560-720 triángulos por copa; detail 0 ≈ 140-180 (para los árboles lejanos de las afueras)
  const deciduous = Array.from({ length: CROWN_VARIANTS }, (_, i) => crownGeometry(17 + i * 31, 5 + i, detail));
  const conifer = coniferGeometry(7);
  const trunk = trunkGeometry();

  const leafMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
  const barkMaterial = new THREE.MeshLambertMaterial({ color: '#7a5a42', map: barkTexture() });

  // Reparto previo: qué árbol es conífera y qué variante de copa lleva cada uno
  const plan = trees.map((tree, i) => {
    const h = hash01(Math.round(tree.x * 7 + tree.z * 13) + i);
    return { tree, h, conifer: h < 0.22, variant: Math.floor(hash01(i * 97 + 5) * CROWN_VARIANTS) };
  });
  const counts = new Array(CROWN_VARIANTS).fill(0);
  let coniferCount = 0;
  for (const p of plan) (p.conifer ? coniferCount++ : counts[p.variant]++);

  const crownMeshes = deciduous.map((geometry, i) => new THREE.InstancedMesh(geometry, leafMaterial, Math.max(1, counts[i])));
  const coniferMesh = new THREE.InstancedMesh(conifer, leafMaterial, Math.max(1, coniferCount));
  const trunkMesh = new THREE.InstancedMesh(trunk, barkMaterial, trees.length);
  const used = new Array(CROWN_VARIANTS).fill(0);
  let coniferUsed = 0;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const tint = new THREE.Color();
  plan.forEach(({ tree, h, conifer: isConifer, variant }, i) => {
    const r = tree.r;
    const spin = h * Math.PI * 2;
    // Tronco: más alto y fino en las coníferas (la copa empieza más abajo)
    const trunkH = isConifer ? 7 + r * 0.5 : 8 + r * 0.6;
    const girth = isConifer ? 1.3 + r * 0.04 : 1.5 + r * 0.06;
    dummy.position.set(tree.x, baseY, tree.z);
    dummy.rotation.set(0, spin, 0);
    dummy.scale.set(girth, trunkH * (isConifer ? 1.9 : 1.05), girth);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);

    // Tono por árbol con una leve variación de brillo
    const palette = isConifer ? CONIFER_COLORS : LEAF_COLORS;
    color.set(palette[Math.floor(hash01(i * 31 + 3) * palette.length)]);
    tint.setHSL(0, 0, 0.9 + hash01(i * 53 + 11) * 0.2);
    color.multiply(tint);

    if (isConifer) {
      dummy.position.set(tree.x, baseY + trunkH * 0.55, tree.z);
      dummy.rotation.set(0, spin, 0);
      dummy.scale.set(r * 0.85, r * 1.25, r * 0.85);
      dummy.updateMatrix();
      coniferMesh.setMatrixAt(coniferUsed, dummy.matrix);
      coniferMesh.setColorAt(coniferUsed++, color);
    } else {
      // Mismo centro y tamaño que la copa de antes (radio r), con una ligera inclinación natural
      dummy.position.set(tree.x, baseY + trunkH + r * 0.55, tree.z);
      dummy.rotation.set((h - 0.5) * 0.16, spin, (hash01(i + 77) - 0.5) * 0.16);
      dummy.scale.set(r, r * (0.88 + h * 0.14), r);
      dummy.updateMatrix();
      const mesh = crownMeshes[variant];
      mesh.setMatrixAt(used[variant], dummy.matrix);
      mesh.setColorAt(used[variant]++, color);
    }
  });

  crownMeshes.forEach((mesh, i) => { mesh.count = used[i]; });
  coniferMesh.count = coniferUsed;
  const meshes = [trunkMesh, ...crownMeshes, coniferMesh].filter((mesh) => mesh.count > 0);
  for (const mesh of meshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  return {
    meshes,
    dispose() {
      for (const geometry of [...deciduous, conifer, trunk]) geometry.dispose();
      leafMaterial.dispose();
      barkMaterial.dispose(); // la textura de corteza es compartida y no se libera
      for (const mesh of [trunkMesh, ...crownMeshes, coniferMesh]) mesh.dispose();
    },
  };
}
