// Estado serializable de la partida. Todo lo que hay aquí se guarda en localStorage.

import { CITY_LAYOUT_VERSION, SAVE_VERSION, START_MONEY, START_REPUTATION } from '../config/constants.js';
import { STARTER_VEHICLE } from '../config/vehicles.js';
import { ZONE_ORDER } from '../config/zones.js';

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
      vehicleId: 'v1',
      x: depot.startX,
      y: depot.startY,
      angle: 0,
      speed: 0,
      cargo: [],
      distanceDriven: 0,
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
