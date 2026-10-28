// Persistencia en localStorage con validación básica y tolerancia a datos corruptos.

import { SAVE_KEY, SAVE_VERSION, SETTINGS_KEY } from '../config/constants.js';
import { mergeDefaults } from './util.js';
import { createInitialState } from './state.js';

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveState(state) {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
    return true;
  } catch (error) {
    console.warn('No se pudo guardar la partida:', error);
    return false;
  }
}

/** Devuelve el estado guardado ya validado, o null si no existe o no es válido. */
export function loadState(city) {
  const storage = safeStorage();
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SAVE_VERSION) throw new Error('Versión de guardado incompatible');
    const state = sanitizeState(mergeDefaults(createInitialState(city), parsed), city);
    return state;
  } catch (error) {
    console.warn('Partida guardada inválida, se empieza de nuevo:', error);
    try {
      storage.setItem(`${SAVE_KEY}:corrupt`, raw);
    } catch { /* sin espacio: se ignora */ }
    return null;
  }
}

export function clearSave() {
  const storage = safeStorage();
  try {
    storage?.removeItem(SAVE_KEY);
  } catch { /* nada que hacer */ }
}

export function hasSave() {
  try {
    return Boolean(safeStorage()?.getItem(SAVE_KEY));
  } catch {
    return false;
  }
}

/** Repara referencias rotas y reinicia tareas automáticas en curso (no se guardan a mitad de viaje). */
export function sanitizeState(state, city) {
  // Las zonas desbloqueadas deben estar activas antes de comprobar colisiones
  city.setUnlockedZones(state.zones);
  state.orders = state.orders.filter((o) => city.getBuilding(o.buildingId) && o.buildingId !== 'depot');
  const orderIds = new Set(state.orders.map((o) => o.id));

  if (!state.vehicles.length) state.vehicles.push({ id: 'v_restored', typeId: 'van_starter', driver: 'player' });
  if (!state.vehicles.some((v) => v.id === state.player.vehicleId)) state.player.vehicleId = state.vehicles[0].id;
  for (const vehicle of state.vehicles) {
    if (vehicle.driver === 'player' && vehicle.id !== state.player.vehicleId) vehicle.driver = null;
    if (vehicle.driver && vehicle.driver !== 'player' && !state.workers.some((w) => w.id === vehicle.driver)) vehicle.driver = null;
  }
  state.vehicles.find((v) => v.id === state.player.vehicleId).driver = 'player';

  state.player.cargo = state.player.cargo.filter((id) => orderIds.has(id));
  const cargoSet = new Set(state.player.cargo);
  for (const order of state.orders) {
    if (cargoSet.has(order.id)) {
      order.assignedTo = 'player';
      if (order.status === 'pending') order.status = 'picked';
    } else {
      // Entregas automáticas interrumpidas: el pedido vuelve al almacén
      order.assignedTo = null;
      order.status = 'pending';
    }
  }

  const spawn = city.depot;
  if (city.circleHitsSolid(state.player.x, state.player.y, 10)) {
    state.player.x = spawn.startX;
    state.player.y = spawn.startY;
    state.player.speed = 0;
  }
  state.workers.forEach((worker, index) => {
    if (worker.vehicleId && !state.vehicles.some((v) => v.id === worker.vehicleId)) worker.vehicleId = null;
    // Nombres puestos por el jugador: se limpian por si el guardado se editó a mano
    const name = typeof worker.name === 'string' ? worker.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 18) : '';
    worker.name = name || `Empleado ${index + 1}`;
  });
  return state;
}

export function loadSettings() {
  try {
    const raw = safeStorage()?.getItem(SETTINGS_KEY);
    return { sound: true, view: '3d', ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { sound: true, view: '3d' };
  }
}

export function saveSettings(settings) {
  try {
    safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignorado */ }
}
