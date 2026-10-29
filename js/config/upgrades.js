// Catálogo de mejoras. Los efectos reales se calculan en systems/stats.js
// a partir de los niveles comprados; "describe" solo genera el texto.

export const UPGRADE_CATEGORIES = [
  { id: 'vehicles', name: 'Vehículos', icon: '🚐' },
  { id: 'warehouse', name: 'Almacén', icon: '🏭' },
  { id: 'business', name: 'Empresa', icon: '💼' },
  { id: 'tech', name: 'Tecnología', icon: '🛸' },
];

const pct = (n) => `${Math.round(n)} %`;

export const UPGRADES = {
  // ---------------- Vehículos ----------------
  engine: {
    id: 'engine', category: 'vehicles', name: 'Motor mejorado', icon: '🔧', maxLevel: 8,
    baseCost: 60, growth: 1.6, unlockLevel: 1,
    description: 'Aumenta la velocidad máxima de todos tus vehículos.',
    describe: (l) => `+${pct(8 * l)} velocidad máxima`,
  },
  accel: {
    id: 'accel', category: 'vehicles', name: 'Mejor aceleración', icon: '🚀', maxLevel: 6,
    baseCost: 70, growth: 1.55, unlockLevel: 1,
    description: 'Los vehículos alcanzan antes su velocidad máxima.',
    describe: (l) => `+${pct(10 * l)} aceleración`,
  },
  cargo: {
    id: 'cargo', category: 'vehicles', name: 'Mayor capacidad de carga', icon: '📦', maxLevel: 5,
    baseCost: 160, growth: 1.9, unlockLevel: 2,
    description: 'Estanterías interiores: +1 hueco de carga en cada vehículo.',
    describe: (l) => `+${l} hueco${l === 1 ? '' : 's'} de carga`,
  },
  fuel: {
    id: 'fuel', category: 'vehicles', name: 'Mejor consumo', icon: '⛽', maxLevel: 6,
    baseCost: 100, growth: 1.6, unlockLevel: 2,
    description: 'Reduce el gasto de combustible por kilómetro.',
    describe: (l) => `-${pct((1 - Math.pow(0.92, l)) * 100)} combustible`,
  },
  handling: {
    id: 'handling', category: 'vehicles', name: 'Mejor maniobrabilidad', icon: '🎯', maxLevel: 5,
    baseCost: 80, growth: 1.5, unlockLevel: 2,
    description: 'Dirección más ágil, ideal para esquinas y calles estrechas.',
    describe: (l) => `+${pct(8 * l)} agilidad de giro`,
  },
  guideArrow: {
    id: 'guideArrow', category: 'vehicles', name: 'Flecha guía', icon: '➤', maxLevel: 1,
    cost: 120, unlockLevel: 1,
    description: 'Una flecha pequeña junto al vehículo señala el destino de entrega más cercano.',
    describe: (l) => (l ? 'Flecha de entrega activada' : 'Sin flecha guía'),
  },
  garage: {
    id: 'garage', category: 'vehicles', name: 'Plazas de garaje', icon: '🅿️', maxLevel: 6,
    baseCost: 400, growth: 2.2, unlockLevel: 3,
    description: 'Más espacio para aparcar vehículos adicionales en la flota.',
    describe: (l) => `${1 + l} vehículos máximos`,
  },

  // ---------------- Almacén ----------------
  storage: {
    id: 'storage', category: 'warehouse', name: 'Ampliar almacenamiento', icon: '🗄️', maxLevel: 8,
    baseCost: 120, growth: 1.65, unlockLevel: 1,
    description: 'Más estanterías: caben más paquetes esperando a ser repartidos.',
    describe: (l) => `${6 + 3 * l} huecos de almacén`,
  },
  prep: {
    id: 'prep', category: 'warehouse', name: 'Preparación más rápida', icon: '⏱️', maxLevel: 6,
    baseCost: 150, growth: 1.7, unlockLevel: 2,
    description: 'Carros de mano y escáneres: tus preparadores empaquetan más deprisa y tú te mueves más rápido a pie por el almacén.',
    describe: (l) => `+${pct(20 * l)} preparación · +${pct(6 * l)} velocidad a pie`,
  },
  organization: {
    id: 'organization', category: 'warehouse', name: 'Organización logística', icon: '🧭', maxLevel: 5,
    baseCost: 350, growth: 1.9, unlockLevel: 4,
    description: 'Procesos mejor definidos: tus empleados trabajan más rápido.',
    describe: (l) => `+${pct(6 * l)} eficiencia de empleados`,
  },
  hq: {
    id: 'hq', category: 'warehouse', name: 'Ampliar la sede', icon: '🏢', maxLevel: 4,
    costs: [1500, 5500, 16000, 45000], levelReqs: [5, 6, 7, 10],
    description: 'Una sede mayor admite más personal y más pedidos activos.',
    describe: (l) => {
      const names = ['Local de barrio', 'Oficina', 'Centro de operaciones', 'Centro logístico', 'Sede corporativa'];
      const staff = [2, 5, 9, 14, 20][l];
      return `${names[l]} · ${staff} empleados · +${l} pedidos activos`;
    },
  },

  // ---------------- Empresa ----------------
  orderSlots: {
    id: 'orderSlots', category: 'business', name: 'Más pedidos activos', icon: '🗂️', maxLevel: 8,
    baseCost: 100, growth: 1.75, unlockLevel: 2,
    description: 'Aumenta el número máximo de pedidos simultáneos.',
    describe: (l) => `+${l} pedido${l === 1 ? '' : 's'} activo${l === 1 ? '' : 's'}`,
  },
  marketing: {
    id: 'marketing', category: 'business', name: 'Campaña de marketing', icon: '📣', maxLevel: 6,
    baseCost: 200, growth: 1.8, unlockLevel: 3,
    description: 'Llegan pedidos con más frecuencia.',
    describe: (l) => `-${pct(6 * l)} tiempo entre pedidos`,
  },
  premium: {
    id: 'premium', category: 'business', name: 'Clientes premium', icon: '💎', maxLevel: 8,
    baseCost: 250, growth: 1.85, unlockLevel: 3,
    description: 'Pedidos más rentables: aumenta la recompensa de todas las entregas.',
    describe: (l) => `+${pct(6 * l)} recompensa`,
  },
  service: {
    id: 'service', category: 'business', name: 'Atención al cliente', icon: '⭐', maxLevel: 4,
    baseCost: 250, growth: 2.0, unlockLevel: 3,
    description: 'Cada entrega a tiempo mejora más tu reputación.',
    describe: (l) => `+${pct(25 * l)} reputación ganada`,
  },
  costControl: {
    id: 'costControl', category: 'business', name: 'Reducción de costes', icon: '🧾', maxLevel: 6,
    baseCost: 300, growth: 1.9, unlockLevel: 4,
    description: 'Negocia combustible, sueldos y mantenimiento: gastos operativos más bajos.',
    describe: (l) => `-${pct((1 - Math.pow(0.93, l)) * 100)} gastos operativos`,
  },
  routes: {
    id: 'routes', category: 'business', name: 'Eficiencia de rutas', icon: '🗺️', maxLevel: 6,
    baseCost: 400, growth: 1.8, unlockLevel: 4,
    description: 'Rutas planificadas: repartidores y drones trabajan más rápido.',
    describe: (l) => `+${pct(5 * l)} velocidad automática`,
  },
  fragilePacking: {
    id: 'fragilePacking', category: 'business', name: 'Embalaje especial', icon: '🍷', maxLevel: 1,
    cost: 1200, unlockLevel: 5,
    description: 'Desbloquea envíos frágiles: pagan más, pero un golpe fuerte los daña. Solo los entregas tú.',
    describe: (l) => (l ? 'Envíos frágiles disponibles' : 'Sin envíos frágiles'),
  },
  contracts: {
    id: 'contracts', category: 'business', name: 'Contratos comerciales', icon: '📑', maxLevel: 1,
    cost: 4000, unlockLevel: 6, requires: [{ id: 'hq', level: 2 }],
    description: 'Contratos con tiendas y empresas: medianos y grandes con el doble de recompensa.',
    describe: (l) => (l ? 'Contratos comerciales disponibles' : 'Sin contratos comerciales'),
  },

  // ---------------- Tecnología ----------------
  autoDispatch: {
    id: 'autoDispatch', category: 'tech', name: 'Automatización avanzada', icon: '🤖', maxLevel: 3,
    costs: [6000, 14000, 30000], levelReqs: [7, 8, 10], requires: [{ id: 'hq', level: 3 }],
    description: 'Los repartidores combinan varias entregas en un mismo viaje.',
    describe: (l) => `${1 + l} paradas por viaje`,
  },
  droneProgram: {
    id: 'droneProgram', category: 'tech', name: 'Programa de drones', icon: '🛸', maxLevel: 1,
    cost: 15000, unlockLevel: 8, requires: [{ id: 'hq', level: 3 }],
    description: 'Permite comprar drones básicos. Entregan paquetes pequeños sin pisar la carretera.',
    describe: (l) => (l ? 'Drones básicos desbloqueados' : 'Drones bloqueados'),
  },
  controlCenter: {
    id: 'controlCenter', category: 'tech', name: 'Centro de control', icon: '🎛️', maxLevel: 3,
    costs: [12000, 28000, 60000], levelReqs: [8, 10, 12], requires: [{ id: 'droneProgram', level: 1 }],
    description: 'Gestiona más drones a la vez desde la sede.',
    describe: (l) => `${2 + 4 * l} drones máximos`,
  },
  droneAdvanced: {
    id: 'droneAdvanced', category: 'tech', name: 'Drones avanzados', icon: '🚁', maxLevel: 1,
    cost: 22000, unlockLevel: 9, requires: [{ id: 'droneProgram', level: 1 }],
    description: 'Investigación de drones veloces, con gran autonomía y capaces de llevar paquetes medianos.',
    describe: (l) => (l ? 'Dron avanzado disponible' : 'Dron avanzado bloqueado'),
  },
  droneHeavy: {
    id: 'droneHeavy', category: 'tech', name: 'Drones de gran capacidad', icon: '🛩️', maxLevel: 1,
    cost: 35000, unlockLevel: 10, requires: [{ id: 'droneAdvanced', level: 1 }],
    description: 'Drones de carga pesada capaces de transportar incluso paquetes grandes.',
    describe: (l) => (l ? 'Dron de gran capacidad disponible' : 'Dron de gran capacidad bloqueado'),
  },
  droneSwarm: {
    id: 'droneSwarm', category: 'tech', name: 'Flota de drones coordinada', icon: '🐝', maxLevel: 2,
    costs: [45000, 90000], levelReqs: [11, 13], requires: [{ id: 'controlCenter', level: 2 }],
    description: 'Inteligencia de enjambre: drones más veloces y con recargas más cortas.',
    describe: (l) => `+${pct(20 * l)} velocidad · -${pct((1 - Math.pow(0.7, l)) * 100)} recarga`,
  },
};

export const UPGRADE_ORDER = Object.keys(UPGRADES);
