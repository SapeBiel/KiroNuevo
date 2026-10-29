// Tipos de empleados. El sueldo se paga al final de cada jornada.

export const WORKER_TYPES = {
  courier: {
    id: 'courier', name: 'Repartidor', icon: '🧑‍✈️', unlockLevel: 4,
    cost: 600, salary: 60, costGrowth: 1.35, needsVehicle: true,
    description: 'Hace entregas automáticamente con un vehículo libre de la empresa. Cobra un sueldo diario.',
  },
  picker: {
    id: 'picker', name: 'Preparador de pedidos', icon: '🧑‍🏭', unlockLevel: 4,
    cost: 450, salary: 40, costGrowth: 1.35, needsVehicle: false, max: 6,
    description: 'Trabaja en su puesto del almacén: recoge los productos de la cinta, los empaqueta y deja la caja en expedición. Cada uno acelera un 15 % el empaquetado. Hasta 6 puestos.',
  },
  manager: {
    id: 'manager', name: 'Encargado de logística', icon: '🧑‍💼', unlockLevel: 6,
    cost: 1400, salary: 90, costGrowth: 1.6, needsVehicle: false, max: 3,
    description: 'Optimiza rutas: +8 % de velocidad en repartidores y drones. Hasta 3 encargados.',
  },
};

export const WORKER_ORDER = ['courier', 'picker', 'manager'];

/** Plazas de personal según el nivel de la sede. */
export const STAFF_BY_HQ_LEVEL = [2, 5, 9, 14, 20];

export const FIRST_NAMES = ['Lucía', 'Marcos', 'Elena', 'Pablo', 'Carmen', 'Javier', 'Sara', 'Andrés', 'Marta', 'Diego', 'Irene', 'Raúl', 'Noa', 'Hugo', 'Alma', 'Iván', 'Paula', 'Óscar', 'Nerea', 'Tomás'];
