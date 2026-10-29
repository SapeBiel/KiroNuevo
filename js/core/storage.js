// Persistencia en localStorage con validación básica y tolerancia a datos corruptos.

import { CITY_LAYOUT_VERSION, SAVE_KEY, SAVE_VERSION, SETTINGS_KEY } from '../config/constants.js';
import { mergeDefaults } from './util.js';
import { createInitialState } from './state.js';
import { sanitizeCompany } from '../systems/branding.js';
import { HAND_ITEM_LIMIT, SHELVES, shelfOf } from '../config/products.js';

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
    // ¿Se guardó en esta misma ciudad? (las partidas antiguas no tenían semilla: eran de la ciudad fija)
    const sameCity = parsed.cityLayout === CITY_LAYOUT_VERSION && parsed.citySeed === city.seed;
    const merged = mergeDefaults(createInitialState(city), parsed);
    // Partidas de antes del modo a pie: se sigue al volante del vehículo, donde se dejó
    if (typeof parsed.player?.mode !== 'string') {
      merged.player.mode = 'drive';
      merged.player.foot.x = merged.player.x;
      merged.player.foot.y = merged.player.y;
    }
    const state = sanitizeState(merged, city, sameCity);
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

/** Semilla de la ciudad de la partida guardada (null si no hay partida o es de un generador antiguo). */
export function peekSavedCitySeed() {
  try {
    const raw = safeStorage()?.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SAVE_VERSION || parsed.cityLayout !== CITY_LAYOUT_VERSION) return null;
    return Number.isInteger(parsed.citySeed) ? parsed.citySeed : null;
  } catch {
    return null;
  }
}

export function hasSave() {
  try {
    return Boolean(safeStorage()?.getItem(SAVE_KEY));
  } catch {
    return false;
  }
}

/** Repara referencias rotas y reinicia tareas automáticas en curso (no se guardan a mitad de viaje). */
export function sanitizeState(state, city, sameCity = true) {
  // Las zonas desbloqueadas deben estar activas antes de comprobar colisiones
  city.setUnlockedZones(state.zones);
  // Partida de una ciudad con otro plano (versión anterior del juego): se conserva el progreso,
  // pero los pedidos apuntaban a otros edificios y el vehículo vuelve a la salida del almacén
  state.citySeed = city.seed;
  state.cityLayout = CITY_LAYOUT_VERSION;
  if (!sameCity) {
    state.orders = [];
    state.player.cargo = [];
    state.player.x = city.depot.startX;
    state.player.y = city.depot.startY;
    state.player.angle = 0;
    state.player.speed = 0;
    state.player.mode = 'drive';
    state.player.hands = { box: '', items: [] };
    // Las plazas donde se dejaron vehículos eran de la ciudad anterior
    for (const vehicle of state.vehicles) delete vehicle.park;
  }
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
  sanitizeHands(state, cargoSet);
  const handBox = state.player.hands.box;
  for (const order of state.orders) {
    if (cargoSet.has(order.id) || order.id === handBox) {
      order.assignedTo = 'player';
      if (order.status === 'pending') order.status = 'picked';
    } else if (order.handling === 'picking' && order.items.some((i) => i.at === 'hand' || i.at === 'table')) {
      // Pedido a medio reunir en la mesa: sigue siendo del jugador
      order.assignedTo = 'player';
      order.status = 'pending';
    } else {
      // Entregas automáticas o trabajo de un preparador interrumpidos: el pedido vuelve al almacén
      // (una caja terminada queda en expedición; los productos sueltos, en el cajón de la cinta)
      order.assignedTo = null;
      order.handling = null;
      order.status = 'pending';
    }
    // Toda caja que no está en las manos está en expedición o en el vehículo: ya está registrada
    if (order.prep <= 0 && order.id !== handBox) order.dispatched = true;
  }

  const spawn = city.depot;
  if (city.circleHitsSolid(state.player.x, state.player.y, 10)) {
    state.player.x = spawn.startX;
    state.player.y = spawn.startY;
    state.player.speed = 0;
  }
  const p = state.player;
  if (p.mode !== 'foot' && p.mode !== 'drive') p.mode = 'drive';
  // Al volante no se lleva nada en las manos (no debería pasar, pero un guardado editado podría)
  if (p.mode === 'drive' && (p.hands.box || p.hands.items.length)) dropHands(state);
  if (p.mode === 'foot' && city.circleHitsSolid(p.foot.x, p.foot.y, 4.5, { walker: true })) {
    p.foot.x = spawn.walkStart.x;
    p.foot.y = spawn.walkStart.y;
  }
  // Se carga con los pies en el suelo
  p.foot.z = 0;
  p.foot.vz = 0;
  state.workers.forEach((worker, index) => {
    if (worker.vehicleId && !state.vehicles.some((v) => v.id === worker.vehicleId)) worker.vehicleId = null;
    // Nombres puestos por el jugador: se limpian por si el guardado se editó a mano
    const name = typeof worker.name === 'string' ? worker.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 18) : '';
    worker.name = name || `Empleado ${index + 1}`;
  });
  // Imagen de la empresa: las partidas antiguas no la tenían y un guardado editado puede traer colores raros
  state.company = sanitizeCompany(state.company);
  return state;
}

/**
 * Productos de cada pedido y lo que el jugador lleva en las manos. Los pedidos de partidas anteriores no
 * tenían lista de productos: se crea a partir de su contenido.
 */
function sanitizeHands(state, cargoSet) {
  for (const order of state.orders) {
    const packed = order.prep <= 0;
    if (!Array.isArray(order.items) || !order.items.length) {
      order.items = [{ name: order.contents || 'Paquete', shelf: shelfOf(order.contents || 'Paquete'), at: packed ? 'box' : 'queued' }];
    }
    for (const item of order.items) {
      if (typeof item.name !== 'string' || !item.name) item.name = order.contents || 'Paquete';
      // 'shelf' era la estantería de la versión anterior: ahora los productos salen por la cinta
      if (item.at === 'shelf') item.at = 'queued';
      if (!VALID_AT.includes(item.at)) item.at = packed ? 'box' : 'queued';
      if (packed) item.at = 'box';
      else if (item.at === 'box') item.at = 'queued';
      // Lo que llevaba o tenía en su mesa un preparador vuelve al cajón de la cinta (el trabajo se reanuda)
      if (item.at === 'worker' || (item.at === 'table' && item.table !== undefined && item.table !== 0)) {
        item.at = 'bin';
        item.binAt = 0;
      }
      if (item.at === 'table') item.table = 0;
      else delete item.table;
      if (item.at === 'belt') item.pos = Number.isFinite(item.pos) ? Math.max(0, item.pos) : 0;
      else delete item.pos;
      delete item.by;
      delete item.station;
      if (!SHELVES.some((s) => s.id === item.shelf)) item.shelf = shelfOf(item.name);
    }
    if (order.handling !== 'picking') order.handling = null;
    if (typeof order.dispatched !== 'boolean') order.dispatched = packed;
  }
  const hands = state.player.hands;
  if (!hands || typeof hands !== 'object') state.player.hands = { box: '', items: [] };
  const h = state.player.hands;
  if (typeof h.box !== 'string') h.box = '';
  const boxOrder = state.orders.find((o) => o.id === h.box);
  if (!boxOrder || cargoSet.has(h.box) || boxOrder.prep > 0) h.box = '';
  // Vehículos dejados por el jugador en un sitio concreto: solo tiene sentido si están libres
  for (const vehicle of state.vehicles) {
    const park = vehicle.park;
    if (vehicle.driver || !park || ![park.x, park.y, park.angle].every(Number.isFinite)) delete vehicle.park;
  }
  if (!Array.isArray(h.items)) h.items = [];
  h.items = h.items.filter((ref) => {
    const item = state.orders.find((o) => o.id === ref?.orderId)?.items?.[ref.index];
    return item && item.at === 'hand';
  }).slice(0, HAND_ITEM_LIMIT);
  // Productos marcados "en la mano" que ya no están en las manos vuelven al cajón de la cinta
  const held = new Set(h.items.map((ref) => `${ref.orderId}:${ref.index}`));
  for (const order of state.orders) {
    order.items.forEach((item, index) => { if (item.at === 'hand' && !held.has(`${order.id}:${index}`)) item.at = 'bin'; });
  }
}

const VALID_AT = ['queued', 'belt', 'bin', 'hand', 'worker', 'table', 'box'];

/** Vacía las manos: la caja vuelve a expedición y los productos sueltos al cajón de la cinta. */
function dropHands(state) {
  const h = state.player.hands;
  const box = state.orders.find((o) => o.id === h.box);
  if (box) { box.assignedTo = null; box.status = 'pending'; box.dispatched = true; }
  for (const ref of h.items) {
    const order = state.orders.find((o) => o.id === ref.orderId);
    const item = order?.items?.[ref.index];
    if (item) item.at = 'bin';
    // Si ya no queda nada suyo en la mesa, el pedido deja de estar reservado
    if (order && !order.items.some((i) => i.at === 'hand' || i.at === 'table')) {
      order.assignedTo = null;
      order.handling = null;
    }
  }
  h.box = '';
  h.items = [];
}

export function loadSettings() {
  try {
    const raw = safeStorage()?.getItem(SETTINGS_KEY);
    return { sound: true, view: '3d', graphics: 'alta', ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { sound: true, view: '3d', graphics: 'alta' };
  }
}

export function saveSettings(settings) {
  try {
    safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignorado */ }
}
