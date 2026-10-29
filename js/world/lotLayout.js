// Distribución de las parcelas con jardín (casas y villas).
// Es la única fuente de verdad: la usan las colisiones (cityMap), el mapa 2D (mapLayer) y los modelos 3D
// (buildings3d), así lo que se ve y lo que choca coinciden siempre.
// Coordenadas locales: origen en el centro de la parcela, x hacia la derecha, z hacia abajo del mapa.

export const GARDEN_KINDS = new Set(['house', 'villa']);

export function hasGarden(b) {
  return GARDEN_KINDS.has(b.kind);
}

/** Casa: cuerpo retirado hacia el fondo, porche delante y, a veces, garaje adosado. */
export function houseLayout(b) {
  const fw = b.pw - 6;
  const fd = b.ph - 6;
  const side = b.door === 'top' ? -1 : 1; // hacia la calle
  // Las parcelas estrechas (2 casillas) no tienen sitio para el garaje
  const garage = b.variant % 2 === 0 && fw >= 80;
  const bw = garage ? fw * 0.6 : fw * 0.72;
  const bd = fd * 0.58;
  // Con garaje la casa se pega a un lado para que el garaje quepa en la parcela
  const bx = garage ? -fw / 2 + 4 + bw / 2 : 0;
  const bz = -side * fd * 0.14;
  const front = bz + side * (bd / 2);
  const gx = bx + bw / 2 + 14;
  return {
    fw, fd, side, garage, bw, bd, bx, bz, front, gx,
    garageWidth: 26, garageDepth: bd * 0.86, garageZ: bz + side * bd * 0.07,
    porch: { x: bx, w: 30, depth: 13 },
  };
}

/** Villa: cuerpo retirado, puerta a un lado y piscina en el jardín delantero. */
export function villaLayout(b) {
  const fw = b.pw - 6;
  const fd = b.ph - 6;
  const side = b.door === 'top' ? -1 : 1;
  const bw = fw * 0.66;
  const bd = fd * 0.56;
  const bz = -side * fd * 0.16;
  const front = bz + side * (bd / 2);
  const doorX = -bw * 0.28;
  const yard = fd / 2 - Math.abs(front);
  const poolDepth = Math.max(10, yard - 16);
  const poolZ = front + side * (4 + (poolDepth + 4) / 2);
  return {
    fw, fd, side, bw, bd, bz, front, doorX,
    pool: { x: bw * 0.22, z: poolZ, w: bw * 0.46, d: poolDepth + 4, waterW: bw * 0.42, waterD: poolDepth },
  };
}

/** Rectángulo local (centro + tamaño) a coordenadas del mapa. */
function toWorld(b, cx, cz, w, d) {
  return { x0: b.centerX + cx - w / 2, y0: b.centerY + cz - d / 2, x1: b.centerX + cx + w / 2, y1: b.centerY + cz + d / 2 };
}

/** Rectángulo local entre dos profundidades z (en cualquier orden). */
function spanWorld(b, cx, w, zA, zB) {
  const z0 = Math.min(zA, zB);
  const z1 = Math.max(zA, zB);
  return toWorld(b, cx, (z0 + z1) / 2, w, z1 - z0);
}

/**
 * Obstáculos de una parcela con jardín. El jardín delantero (césped, seto, arbustos y camino) queda libre.
 * Detrás de la fachada se bloquea todo el ancho de la parcela: los huecos laterales junto a la casa
 * son más estrechos que una furgoneta, y así no queda ninguno en el que encajarse.
 */
export function gardenColliders(b) {
  const halfDepth = b.ph / 2;
  if (b.kind === 'house') {
    const L = houseLayout(b);
    const facade = L.front + L.side * 1.5; // zócalo de la casa
    return [
      spanWorld(b, 0, b.pw, facade, -L.side * halfDepth),
      spanWorld(b, L.porch.x, L.porch.w, L.front, L.front + L.side * L.porch.depth),
    ];
  }
  if (b.kind === 'villa') {
    const L = villaLayout(b);
    const facade = L.front + L.side * 1.5;
    return [
      spanWorld(b, 0, b.pw, facade, -L.side * halfDepth),
      // Piscina: no se puede conducir por dentro
      toWorld(b, L.pool.x, L.pool.z, L.pool.w, L.pool.d),
    ];
  }
  return [];
}

/**
 * Punto delante de la puerta del destinatario donde el repartidor, a pie, entrega el paquete.
 * En casas y villas está delante del porche (la casa se retira al fondo de la parcela);
 * en el resto de edificios, en la acera frente a la puerta.
 */
export function deliveryDoorPoint(b) {
  const side = b.door === 'top' ? -1 : 1;
  if (b.kind === 'house') {
    const L = houseLayout(b);
    return { x: b.centerX + L.bx, y: b.centerY + L.front + side * (L.porch.depth + 7) };
  }
  if (b.kind === 'villa') {
    const L = villaLayout(b);
    return { x: b.centerX + L.doorX, y: b.centerY + L.front + side * 8 };
  }
  return { x: b.doorX, y: b.doorY + side * 7 };
}
