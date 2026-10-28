// Elementos de la ciudad que no son edificios: árboles de los parques, farolas y barreras de zonas bloqueadas.

import * as THREE from '../vendor/three.module.js';
import { MAP_TILES_X, MAP_TILES_Y, TILE } from '../config/constants.js';
import { getGlowTexture, getHazardTexture } from './textures3d.js';

const TREE_COLORS = ['#3f9a54', '#4aa85f', '#5bb86b', '#388a4c', '#6cbf6e'];

/** Árboles de los parques (una sola malla instanciada para troncos y otra para copas). */
export function buildTrees(city) {
  const group = new THREE.Group();
  const trees = city.parks.flatMap((park) => park.trees);
  if (!trees.length) return { group, dispose() {} };

  const trunkGeometry = new THREE.CylinderGeometry(1.6, 2.2, 1, 6);
  trunkGeometry.translate(0, 0.5, 0);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshLambertMaterial({ color: '#6b4a32' }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), trees.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  trees.forEach((tree, index) => {
    const trunkHeight = 8 + tree.r * 0.6;
    dummy.position.set(tree.x, 0, tree.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, trunkHeight, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);

    dummy.position.set(tree.x, trunkHeight + tree.r * 0.55, tree.y);
    dummy.rotation.set(0, index * 1.7, 0);
    dummy.scale.set(tree.r, tree.r * 0.95, tree.r);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    color.set(TREE_COLORS[index % TREE_COLORS.length]);
    crowns.setColorAt(index, color);
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  crowns.instanceColor.needsUpdate = true;

  return {
    group,
    dispose() {
      trunkGeometry.dispose();
      crownGeometry.dispose();
      trunks.material.dispose();
      crowns.material.dispose();
      trunks.dispose();
      crowns.dispose();
    },
  };
}

/** Farolas: postes, bombillas y halos. Devuelve también las posiciones para las luces reales. */
export function buildLamps(city) {
  const group = new THREE.Group();
  const lamps = city.lampPosts;
  const poleGeometry = new THREE.CylinderGeometry(1.1, 1.7, 1, 6);
  poleGeometry.translate(0, 0.5, 0);
  const poles = new THREE.InstancedMesh(poleGeometry, new THREE.MeshLambertMaterial({ color: '#4b5263' }), lamps.length);
  const headGeometry = new THREE.BoxGeometry(7, 2, 4);
  const heads = new THREE.InstancedMesh(headGeometry, new THREE.MeshLambertMaterial({ color: '#3b4252' }), lamps.length);
  const bulbGeometry = new THREE.SphereGeometry(2.2, 8, 6);
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: '#8d93a0' });
  const bulbs = new THREE.InstancedMesh(bulbGeometry, bulbMaterial, lamps.length);
  const dummy = new THREE.Object3D();
  const glowPositions = new Float32Array(lamps.length * 3);
  const poleHeight = 38;

  lamps.forEach((lamp, index) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(lamp.x, 0, lamp.y);
    dummy.scale.set(1, poleHeight, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(index, dummy.matrix);

    dummy.position.set(lamp.x, poleHeight + 1, lamp.y);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    heads.setMatrixAt(index, dummy.matrix);

    dummy.position.set(lamp.x, poleHeight - 1.2, lamp.y);
    dummy.updateMatrix();
    bulbs.setMatrixAt(index, dummy.matrix);

    glowPositions[index * 3] = lamp.x;
    glowPositions[index * 3 + 1] = poleHeight - 1;
    glowPositions[index * 3 + 2] = lamp.y;
  });
  poles.castShadow = true;
  heads.castShadow = true;
  for (const mesh of [poles, heads, bulbs]) {
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
  const glowMaterial = new THREE.PointsMaterial({
    map: getGlowTexture(), color: '#ffc477', size: 46, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const glow = new THREE.Points(glowGeometry, glowMaterial);
  glow.frustumCulled = false;
  glow.visible = false;
  group.add(glow);

  const off = new THREE.Color('#8d93a0');
  const on = new THREE.Color('#ffe9a6');
  return {
    group,
    setNight(darkness) {
      bulbMaterial.color.copy(off).lerp(on, Math.min(1, darkness * 1.6));
      glowMaterial.opacity = Math.min(1, darkness * 1.1) * 0.85;
      glow.visible = darkness > 0.04;
    },
    dispose() {
      for (const geometry of [poleGeometry, headGeometry, bulbGeometry, glowGeometry]) geometry.dispose();
      for (const mesh of [poles, heads, bulbs]) {
        mesh.material.dispose();
        mesh.dispose();
      }
      glowMaterial.dispose();
    },
  };
}

/** Vallas a rayas en la frontera entre la zona desbloqueada y la bloqueada. */
export function buildBarriers(city) {
  const group = new THREE.Group();
  const alongX = [];
  const alongZ = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (city.isZoneUnlocked(city.zoneIdAtTile(tx, ty)) || city.isSolidBuildingTile(tx, ty)) continue;
      for (const [dx, dy] of dirs) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_TILES_X || ny >= MAP_TILES_Y) continue;
        if (!city.isZoneUnlocked(city.zoneIdAtTile(nx, ny)) || city.isSolidBuildingTile(nx, ny)) continue;
        if (dx !== 0) {
          alongZ.push({ x: dx > 0 ? (tx + 1) * TILE : tx * TILE, z: (ty + 0.5) * TILE });
        } else {
          alongX.push({ x: (tx + 0.5) * TILE, z: dy > 0 ? (ty + 1) * TILE : ty * TILE });
        }
      }
    }
  }
  if (!alongX.length && !alongZ.length) return { group, dispose() {} };

  const material = new THREE.MeshLambertMaterial({ map: getHazardTexture() });
  const geometries = [];
  const dummy = new THREE.Object3D();
  for (const [list, w, d] of [[alongX, TILE, 6], [alongZ, 6, TILE]]) {
    if (!list.length) continue;
    const geometry = new THREE.BoxGeometry(w, 14, d);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.3, uv.getY(i) * 1.1);
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((item, index) => {
      dummy.position.set(item.x, 7, item.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}
