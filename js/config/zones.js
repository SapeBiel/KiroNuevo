// Zonas (barrios) de la ciudad. Cada una se desbloquea con nivel y dinero.

export const ZONE_ORDER = ['residential', 'downtown', 'commercial', 'industrial', 'metropolitan'];

export const ZONES = {
  residential: {
    id: 'residential',
    name: 'Barrio Residencial',
    icon: '🏡',
    description: 'Casas pequeñas, distancias cortas y pedidos sencillos.',
    unlockLevel: 1,
    unlockCost: 0,
    rewardMult: 1.0,
    orderWeight: 4,
    ground: '#b5dca4',
    sidewalk: '#e4e1d6',
  },
  downtown: {
    id: 'downtown',
    name: 'Centro Urbano',
    icon: '🏙️',
    description: 'Edificios de apartamentos y oficinas. Más destinos y más densidad de pedidos.',
    unlockLevel: 4,
    unlockCost: 2500,
    rewardMult: 1.2,
    orderWeight: 5,
    ground: '#c7ccd6',
    sidewalk: '#dfe2e8',
  },
  commercial: {
    id: 'commercial',
    name: 'Zona Comercial',
    icon: '🛍️',
    description: 'Tiendas y empresas. Los contratos comerciales pagan mucho mejor.',
    unlockLevel: 5,
    unlockCost: 6500,
    rewardMult: 1.35,
    orderWeight: 5,
    ground: '#ecdcc3',
    sidewalk: '#f1e8d9',
  },
  industrial: {
    id: 'industrial',
    name: 'Zona Industrial',
    icon: '🏭',
    description: 'Fábricas y almacenes. Paquetes grandes que exigen vehículos con más capacidad.',
    unlockLevel: 7,
    unlockCost: 14000,
    rewardMult: 1.5,
    orderWeight: 3,
    ground: '#bcc0c4',
    sidewalk: '#d3d6d9',
  },
  metropolitan: {
    id: 'metropolitan',
    name: 'Área Metropolitana',
    icon: '🌆',
    description: 'Rascacielos y urbanizaciones lejanas. Distancias largas y pedidos de alto valor.',
    unlockLevel: 9,
    unlockCost: 40000,
    rewardMult: 2.0,
    orderWeight: 3,
    ground: '#bfe0e0',
    sidewalk: '#dcecec',
  },
};

/** Zona a la que pertenece cada manzana (bc = columna, br = fila). */
export function zoneIdForBlock(bc, br) {
  if (bc <= 2 && br >= 3) return 'residential';
  if (bc <= 2 && br <= 2) return 'industrial';
  if (bc >= 3 && bc <= 4 && br >= 2) return 'downtown';
  if (bc >= 5 && br >= 3) return 'commercial';
  return 'metropolitan';
}

/** Una zona solo puede desbloquearse si ya tienes otra zona contigua. */
export const ZONE_REQUIRES = {
  downtown: 'residential',
  commercial: 'downtown',
  industrial: 'residential',
  metropolitan: 'downtown',
};

export const DEPOT_BLOCK = { bc: 1, br: 4 };

export const HORIZONTAL_STREETS = [
  'Calle Mayor', 'Calle del Roble', 'Calle del Sol', 'Calle Luna',
  'Calle del Río', 'Calle Olmo', 'Calle Cedro',
];
export const VERTICAL_STREETS = [
  'Avenida Norte', 'Avenida del Parque', 'Avenida Central', 'Avenida Mar',
  'Avenida Aurora', 'Avenida Real', 'Avenida del Puerto', 'Avenida Sur', 'Avenida Ancha',
];
