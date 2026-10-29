// Estadísticas derivadas: convierte niveles de mejora y plantilla en valores reales de juego.

import { FUEL_COST_PER_TILE } from '../config/constants.js';
import { getVehicleType } from '../config/vehicles.js';
import { STAFF_BY_HQ_LEVEL } from '../config/workers.js';
import { BASE_DRONE_CAPACITY, DRONES_PER_CONTROL_LEVEL } from '../config/drones.js';

export const upgradeLevel = (state, id) => state.upgrades[id] ?? 0;
export const countWorkers = (state, typeId) => state.workers.filter((w) => w.typeId === typeId).length;

export function computeStats(state) {
  const lvl = (id) => upgradeLevel(state, id);
  const pickers = countWorkers(state, 'picker');
  const managers = countWorkers(state, 'manager');
  const hq = lvl('hq');
  const costMult = Math.pow(0.93, lvl('costControl'));
  const managerBoost = 1 + 0.08 * managers;
  // Cada repartidor o dron trae su propio flujo de pedidos: si no, compiten por los mismos huecos
  // que el jugador y se quedan parados en el almacén.
  const automationUnits = countWorkers(state, 'courier') + state.drones.length;
  const baseSpawnInterval = Math.max(
    3.5,
    15 * Math.pow(0.93, state.level - 1) * (1 - 0.06 * lvl('marketing')) * (1 - state.reputation / 400),
  );
  const spawnInterval = Math.max(1.5, baseSpawnInterval / (1 + 0.3 * automationUnits));
  const droneUnlocked = lvl('droneProgram') > 0;

  return {
    costMult,
    rewardMult: 1 + 0.06 * lvl('premium'),
    reputationRewardMult: 1 + state.reputation / 250,
    reputationGainMult: 1 + 0.25 * lvl('service'),
    storageCapacity: 6 + 3 * lvl('storage'),
    automationUnits,
    maxActiveOrders: 2 + lvl('orderSlots') + hq + automationUnits,
    maxVehicles: 1 + lvl('garage'),
    maxStaff: STAFF_BY_HQ_LEVEL[hq],
    // Sin preparadores, los pedidos los recoge y empaqueta el jugador a mano en el almacén
    prepLanes: pickers,
    prepRate: (1 + 0.2 * lvl('prep')) * (1 + 0.15 * pickers),
    walkSpeedMult: 1 + 0.06 * lvl('prep'),
    spawnInterval,
    staffEfficiency: (1 + 0.06 * lvl('organization')) * (1 + 0.05 * lvl('routes')) * managerBoost,
    maxStops: 1 + lvl('autoDispatch'),
    fragileEnabled: lvl('fragilePacking') > 0,
    contractsEnabled: lvl('contracts') > 0,
    droneUnlocked,
    droneCapacity: droneUnlocked ? BASE_DRONE_CAPACITY + DRONES_PER_CONTROL_LEVEL * lvl('controlCenter') : 0,
    droneSpeedMult: (1 + 0.2 * lvl('droneSwarm')) * (1 + 0.05 * lvl('routes')) * managerBoost,
    droneRechargeMult: Math.pow(0.7, lvl('droneSwarm')),
  };
}

/** Características reales de un vehículo, con las mejoras de la flota aplicadas. */
export function getVehicleStats(state, typeId, derived = computeStats(state)) {
  const type = getVehicleType(typeId);
  const lvl = (id) => upgradeLevel(state, id);
  return {
    type,
    maxSpeed: type.maxSpeed * (1 + 0.08 * lvl('engine')),
    accel: type.accel * (1 + 0.1 * lvl('accel')),
    capacity: type.capacity + lvl('cargo'),
    handling: type.handling * (1 + 0.08 * lvl('handling')),
    fuelPerTile: FUEL_COST_PER_TILE * type.fuel * Math.pow(0.92, lvl('fuel')) * derived.costMult,
  };
}

export function getPlayerVehicle(state) {
  return state.vehicles.find((v) => v.id === state.player.vehicleId);
}

export function maxVehicleCapacity(state, derived) {
  let best = 0;
  for (const vehicle of state.vehicles) best = Math.max(best, getVehicleStats(state, vehicle.typeId, derived).capacity);
  return best;
}
