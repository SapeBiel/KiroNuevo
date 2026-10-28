// Tipos físicos de paquete y tipos de pedido.

export const PACKAGES = {
  small: { id: 'small', name: 'Pequeño', slots: 1, weight: [1, 4], baseReward: 10, perTile: 0.55, xp: 10, prep: 4 },
  medium: { id: 'medium', name: 'Mediano', slots: 2, weight: [5, 14], baseReward: 24, perTile: 0.8, xp: 20, prep: 7 },
  large: { id: 'large', name: 'Grande', slots: 4, weight: [25, 80], baseReward: 60, perTile: 1.25, xp: 45, prep: 12 },
};

export const ORDER_KINDS = {
  small: {
    id: 'small', label: 'Paquete pequeño', short: 'Pequeño', icon: '📦', color: '#4cc9f0',
    sizes: ['small'], rewardMult: 1, xpMult: 1, minLevel: 1, spawnWeight: 10, priority: 'normal',
    contents: ['Libro', 'Auriculares', 'Camiseta', 'Cartas certificadas', 'Cosmética', 'Videojuego', 'Gafas de sol', 'Llaves de repuesto'],
  },
  medium: {
    id: 'medium', label: 'Paquete mediano', short: 'Mediano', icon: '📦', color: '#90be6d',
    sizes: ['medium'], rewardMult: 1, xpMult: 1, minLevel: 2, spawnWeight: 7, priority: 'normal',
    contents: ['Zapatillas', 'Cafetera', 'Caja de herramientas', 'Batidora', 'Altavoz', 'Lámpara de mesa', 'Mochila', 'Juego de sábanas'],
  },
  large: {
    id: 'large', label: 'Paquete grande', short: 'Grande', icon: '🧰', color: '#f9844a',
    sizes: ['large'], rewardMult: 1, xpMult: 1, minLevel: 4, spawnWeight: 3.5, priority: 'normal',
    contents: ['Lavadora', 'Sofá desmontado', 'Bicicleta', 'Televisor 65"', 'Estantería', 'Palé de material'],
  },
  urgent: {
    id: 'urgent', label: 'Pedido urgente', short: 'Urgente', icon: '⚡', color: '#ff4d6d',
    sizes: ['small', 'medium'], rewardMult: 1.8, xpMult: 1.5, minLevel: 3, spawnWeight: 4, priority: 'urgent',
    contents: ['Documentos urgentes', 'Medicamentos', 'Pieza de repuesto', 'Contrato firmado', 'Equipo médico'],
  },
  fragile: {
    id: 'fragile', label: 'Envío frágil', short: 'Frágil', icon: '🍷', color: '#b980f0',
    sizes: ['small', 'medium'], rewardMult: 1.7, xpMult: 1.6, minLevel: 1, spawnWeight: 3, priority: 'high',
    requiresUpgrade: 'fragilePacking',
    contents: ['Jarrón de cristal', 'Cuadro enmarcado', 'Vajilla de porcelana', 'Monitor 4K', 'Instrumento musical'],
  },
  contract: {
    id: 'contract', label: 'Contrato comercial', short: 'Contrato', icon: '📑', color: '#ffd166',
    sizes: ['medium', 'large'], rewardMult: 2.0, xpMult: 2, minLevel: 1, spawnWeight: 3.5, priority: 'high',
    requiresUpgrade: 'contracts',
    buildingKinds: ['shop', 'office', 'factory', 'warehouse', 'tower'],
    contents: ['Suministros de oficina', 'Mercancía para tienda', 'Maquinaria ligera', 'Palé comercial', 'Material de embalaje'],
  },
};

export const KIND_ORDER = ['small', 'medium', 'large', 'urgent', 'fragile', 'contract'];

export const PRIORITY_LABELS = { normal: 'Normal', high: 'Alta', urgent: 'Urgente' };

export const STATUS_LABELS = {
  pending: 'Pendiente',
  picked: 'Recogido',
  in_transit: 'En reparto',
  delivered: 'Entregado',
};

/** Tipos de edificio: aspecto, nombre y si admiten drones. */
export const BUILDING_KINDS = {
  house: { label: 'Casa', droneOk: true },
  villa: { label: 'Villa', droneOk: true },
  apartment: { label: 'Apartamentos', droneOk: true },
  shop: { label: 'Tienda', droneOk: true },
  office: { label: 'Oficinas', droneOk: true },
  tower: { label: 'Torre', droneOk: true },
  factory: { label: 'Fábrica', droneOk: false },
  warehouse: { label: 'Nave', droneOk: false },
  depot: { label: 'Almacén central', droneOk: false },
};

export const SHOP_NAMES = ['Panadería Luna', 'Librería Faro', 'Floristería Iris', 'Ferretería Pino', 'Café Aurora', 'Juguetes Nube', 'Farmacia Sol', 'Moda Brisa', 'Tecno Plus', 'Deportes Ola', 'Fruta Fresca', 'Zapatería Paso'];
export const OFFICE_NAMES = ['Asesoría Norte', 'Estudio Vértice', 'Seguros Alba', 'Consultora Delta', 'Clínica Mar', 'Notaría Real', 'Agencia Nexo', 'Software Prisma'];
export const FACTORY_NAMES = ['Fábrica Acero', 'Plásticos Norte', 'Textil Ríos', 'Metalúrgica Sur', 'Envases Ebro', 'Maquinaria Gil'];
export const WAREHOUSE_NAMES = ['Logística Este', 'Almacén Delta', 'Distribuciones Roca', 'Naves Omega', 'Depósito Gamma'];
export const TOWER_NAMES = ['Torre Zenit', 'Torre Atlas', 'Torre Mirador', 'Torre Cristal', 'Torre Horizonte', 'Torre Aurora', 'Torre Vega'];
