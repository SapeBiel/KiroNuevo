// Drones: entregas aéreas automáticas. speed en px/s, range = distancia máxima (px) desde el almacén.

export const DRONE_TYPES = {
  drone_basic: {
    id: 'drone_basic', name: 'Dron básico', icon: '🛸', color: '#8ecae6',
    cost: 2500, upkeep: 20, speed: 140, capacity: 1, range: 900, recharge: 6,
    requires: 'droneProgram', costGrowth: 1.12,
    description: 'Entrega paquetes pequeños en un radio corto alrededor del almacén.',
  },
  drone_advanced: {
    id: 'drone_advanced', name: 'Dron avanzado', icon: '🚁', color: '#ffb703',
    cost: 6000, upkeep: 35, speed: 240, capacity: 2, range: 2000, recharge: 4.5,
    requires: 'droneAdvanced', costGrowth: 1.12,
    description: 'Más veloz y con mucha más autonomía. Admite paquetes medianos.',
  },
  drone_heavy: {
    id: 'drone_heavy', name: 'Dron de gran capacidad', icon: '🛩️', color: '#fb8500',
    cost: 9500, upkeep: 55, speed: 170, capacity: 4, range: 1500, recharge: 8,
    requires: 'droneHeavy', costGrowth: 1.12,
    description: 'Transporta incluso paquetes grandes. Recarga más lenta.',
  },
};

export const DRONE_ORDER = ['drone_basic', 'drone_advanced', 'drone_heavy'];

export const BASE_DRONE_CAPACITY = 2; // drones permitidos sin centro de control
export const DRONES_PER_CONTROL_LEVEL = 4;
