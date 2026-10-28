// Vehículos de la flota. Cada uno tiene características diferenciadas.
// maxSpeed y accel en px/s y px/s²; capacity en "huecos" de carga.

export const VEHICLES = {
  van_basic: {
    id: 'van_basic', name: 'Furgoneta básica', icon: '🚐', color: '#f4b942',
    cost: 750, unlockLevel: 3,
    maxSpeed: 150, accel: 230, capacity: 3, fuel: 1.0, upkeep: 8, handling: 1.0,
    length: 38, width: 22, shape: 'van',
    description: 'Barata y fiable. Ideal para empezar a repartir.',
  },
  van_large: {
    id: 'van_large', name: 'Furgoneta grande', icon: '🚚', color: '#4fa3e0',
    cost: 1800, unlockLevel: 3,
    maxSpeed: 165, accel: 215, capacity: 6, fuel: 1.35, upkeep: 14, handling: 0.95,
    length: 42, width: 23, shape: 'van',
    description: 'Más espacio de carga a costa de gastar más combustible.',
  },
  van_electric: {
    id: 'van_electric', name: 'Furgoneta eléctrica', icon: '⚡', color: '#46c28e',
    cost: 4200, unlockLevel: 5,
    maxSpeed: 185, accel: 300, capacity: 5, fuel: 0.35, upkeep: 12, handling: 1.1,
    length: 40, width: 22, shape: 'electric',
    description: 'Rápida y casi sin gasto de combustible.',
  },
  truck: {
    id: 'truck', name: 'Camión de reparto', icon: '🚛', color: '#e0605a',
    cost: 7800, unlockLevel: 6,
    maxSpeed: 140, accel: 160, capacity: 14, fuel: 2.2, upkeep: 28, handling: 0.75,
    length: 56, width: 25, shape: 'truck',
    description: 'Enorme capacidad para contratos y paquetes grandes. Lento y sediento.',
  },
};

export const VEHICLE_ORDER = ['van_basic', 'van_large', 'van_electric', 'truck'];

/** Vehículo con el que empieza la partida (no se compra). */
export const STARTER_VEHICLE = {
  id: 'van_starter', name: 'Furgoneta de reparto', icon: '🚐', color: '#f4b942',
  cost: 0, unlockLevel: 1,
  maxSpeed: 150, accel: 230, capacity: 3, fuel: 1.0, upkeep: 8, handling: 1.0,
  length: 38, width: 22, shape: 'van',
  description: 'Tu primera furgoneta.',
};

export function getVehicleType(typeId) {
  return typeId === STARTER_VEHICLE.id ? STARTER_VEHICLE : VEHICLES[typeId];
}
