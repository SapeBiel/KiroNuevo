// Flota: compra de vehículos y cambio del vehículo que conduce el jugador.

import { VEHICLES, getVehicleType } from '../config/vehicles.js';
import { formatMoney } from '../core/util.js';
import { allocateId } from '../core/state.js';
import { spend } from './economy.js';

export const freeVehicles = (state) => state.vehicles.filter((v) => !v.driver);

export function vehiclePurchaseStatus(game, typeId) {
  const { state, derived } = game;
  const type = VEHICLES[typeId];
  if (state.level < type.unlockLevel) return { state: 'locked', reason: `Requiere nivel ${type.unlockLevel}` };
  if (state.vehicles.length >= derived.maxVehicles) return { state: 'locked', reason: 'Garaje lleno: amplía las plazas de garaje' };
  if (state.money < type.cost) return { state: 'poor', reason: `Te faltan ${formatMoney(type.cost - state.money)}` };
  return { state: 'available', reason: '' };
}

export function buyVehicle(game, typeId) {
  const type = VEHICLES[typeId];
  if (!type) return { ok: false, reason: 'Vehículo desconocido' };
  const status = vehiclePurchaseStatus(game, typeId);
  if (status.state !== 'available') return { ok: false, reason: status.reason };
  if (!spend(game, type.cost)) return { ok: false, reason: 'Fondos insuficientes' };
  const vehicle = { id: allocateId(game.state, 'v'), typeId, driver: null };
  game.state.vehicles.push(vehicle);
  game.recomputeStats();
  game.events.emit('vehicleBought', { vehicle, type });
  return { ok: true, vehicle };
}

/** El jugador pasa a conducir otro vehículo libre. Solo en el almacén y con la furgoneta vacía. */
export function driveVehicle(game, vehicleId) {
  const { state } = game;
  const target = state.vehicles.find((v) => v.id === vehicleId);
  if (!target) return { ok: false, reason: 'Vehículo inexistente' };
  if (target.id === state.player.vehicleId) return { ok: false, reason: 'Ya conduces este vehículo' };
  if (target.driver) return { ok: false, reason: 'Lo está usando un empleado' };
  if (!game.isPlayerInDepot()) return { ok: false, reason: 'Ve al almacén para cambiar de vehículo' };
  if (state.player.cargo.length) return { ok: false, reason: 'Descarga primero los paquetes' };
  const previous = state.vehicles.find((v) => v.id === state.player.vehicleId);
  if (previous) previous.driver = null;
  target.driver = 'player';
  state.player.vehicleId = target.id;
  state.player.speed = 0;
  game.events.emit('vehicleChanged', { vehicle: target, type: getVehicleType(target.typeId) });
  return { ok: true };
}
