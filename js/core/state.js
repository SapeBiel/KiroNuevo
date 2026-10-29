// Estado serializable de la partida. Todo lo que hay aquí se guarda en localStorage.

import { CITY_LAYOUT_VERSION, SAVE_VERSION, START_MONEY, START_REPUTATION } from '../config/constants.js';
import { STARTER_VEHICLE } from '../config/vehicles.js';
import { ZONE_ORDER } from '../config/zones.js';
import { DEFAULT_COMPANY } from '../systems/branding.js';

export function createDayStats() {
  return { deliveries: 0, income: 0, fuel: 0, salaries: 0, upkeep: 0, bestStreak: 0, late: 0, urgentOnTime: 0, xp: 0, missionsDone: 0 };
}

export function createInitialState(city) {
  const depot = city.depot;
  const zones = {};
  for (const id of ZONE_ORDER) zones[id] = id === 'residential';
  return {
    version: SAVE_VERSION,
    citySeed: city.seed, // la ciudad se regenera igual al cargar
    cityLayout: CITY_LAYOUT_VERSION,
    createdAt: Date.now(),
    company: { ...DEFAULT_COMPANY }, // nombre, logotipo y colores elegidos por el jugador
    time: 0,
    day: 1,
    dayTime: 0,
    money: START_MONEY,
    xp: 0,
    level: 1,
    reputation: START_REPUTATION,
    stats: {
      totalEarned: 0,
      bonusEarned: 0,
      investments: 0,
      expenses: { fuel: 0, salaries: 0, upkeep: 0 },
      deliveries: 0,
      manualDeliveries: 0,
      workerDeliveries: 0,
      droneDeliveries: 0,
      onTime: 0,
      late: 0,
      urgentOnTime: 0,
      damaged: 0,
      bestStreak: 0,
      ordersCreated: 0,
      ordersRejected: 0,
      itemsPicked: 0,
      boxesPacked: 0,
      boxesDispatched: 0,
    },
    streak: { count: 0, timer: 0 },
    upgrades: {},
    zones,
    vehicles: [{ id: 'v1', typeId: STARTER_VEHICLE.id, driver: 'player' }],
    workers: [],
    drones: [],
    orders: [],
    recentDeliveries: [],
    nextId: 2,
    nextOrderNumber: 1,
    spawnTimer: 14,
    player: {
      // Posición del vehículo (aparcado en el patio del almacén con la trasera hacia la fachada)
      vehicleId: 'v1',
      x: depot.park.x,
      y: depot.park.y,
      angle: depot.park.angle,
      speed: 0,
      cargo: [],
      distanceDriven: 0,
      // 'foot' = a pie (primera persona); 'drive' = al volante
      mode: 'foot',
      // z/vz: altura y velocidad vertical del salto (0 = con los pies en el suelo)
      foot: { x: depot.walkStart.x, y: depot.walkStart.y, yaw: depot.walkStart.yaw, pitch: 0, walked: 0, z: 0, vz: 0, jumps: 0 },
      // Lo que lleva en las manos: una caja (id del pedido, '' si ninguna) o hasta 3 productos sueltos
      hands: { box: '', items: [] },
    },
    missions: [],
    dayStats: createDayStats(),
    history: [],
    pendingSummary: null,
    achievements: {},
    tutorial: { step: 0, done: false, welcomed: false, finishAcknowledged: false },
  };
}

export function allocateId(state, prefix) {
  return `${prefix}${state.nextId++}`;
}
