// Economía: ingresos, gastos, recompensas y costes operativos.
// Todo el dinero entra y sale por estas funciones para evitar duplicados o saldos negativos.

import {
  TILE, STREAK_BONUS_PER_STEP, STREAK_MAX_STEPS, LATE_REWARD_FACTOR, DAMAGED_REWARD_FACTOR,
} from '../config/constants.js';
import { PACKAGES, ORDER_KINDS } from '../config/packages.js';
import { ZONES } from '../config/zones.js';
import { getVehicleType } from '../config/vehicles.js';
import { WORKER_TYPES } from '../config/workers.js';
import { DRONE_TYPES } from '../config/drones.js';
import { formatInt } from '../core/util.js';

const INCOME_WINDOW = 60;

export function earn(game, amount, { auto = false } = {}) {
  const value = Math.round(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const { state, runtime } = game;
  state.money += value;
  state.stats.totalEarned += value;
  state.dayStats.income += value;
  runtime.incomeEvents.push({ t: runtime.clock, amount: value, auto });
  return value;
}

/** Premios de logros y misiones: suman al saldo pero no cuentan como ingresos por entregas. */
export function grantBonus(game, amount) {
  const value = Math.round(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  game.state.money += value;
  game.state.stats.bonusEarned += value;
  return value;
}

/** Gasto voluntario (mejoras, vehículos, contrataciones). Falla si no hay fondos suficientes. */
export function spend(game, amount) {
  const value = Math.round(amount);
  if (!Number.isFinite(value) || value < 0) return false;
  if (game.state.money < value) return false;
  game.state.money -= value;
  game.state.stats.investments += value;
  return true;
}

/** Gasto operativo (combustible, sueldos, mantenimiento). Nunca deja el saldo en negativo. */
export function chargeOperating(game, amount, category) {
  const value = Math.round(amount);
  if (!Number.isFinite(value) || value <= 0) return { paid: 0, unpaid: 0 };
  const { state } = game;
  const paid = Math.min(state.money, value);
  state.money -= paid;
  state.stats.expenses[category] += paid;
  state.dayStats[category] += paid;
  return { paid, unpaid: value - paid };
}

/** Acumula el combustible en fracciones y cobra euros enteros. */
export function chargeFuel(game, distancePx, fuelPerTile) {
  const { runtime } = game;
  runtime.fuelDebt += (distancePx / TILE) * fuelPerTile;
  if (runtime.fuelDebt >= 1) {
    const whole = Math.floor(runtime.fuelDebt);
    runtime.fuelDebt -= whole;
    chargeOperating(game, whole, 'fuel');
  }
}

function incomeInWindow(game, onlyAuto) {
  const { runtime } = game;
  const threshold = runtime.clock - INCOME_WINDOW;
  while (runtime.incomeEvents.length && runtime.incomeEvents[0].t < threshold) runtime.incomeEvents.shift();
  let sum = 0;
  for (const event of runtime.incomeEvents) if (!onlyAuto || event.auto) sum += event.amount;
  const window = Math.min(INCOME_WINDOW, Math.max(20, runtime.clock));
  return (sum / window) * 60;
}

export const incomePerMinute = (game) => incomeInWindow(game, false);
export const autoIncomePerMinute = (game) => incomeInWindow(game, true);

export function computeDailyCosts(game) {
  const { state, derived } = game;
  let salaries = 0;
  for (const worker of state.workers) salaries += WORKER_TYPES[worker.typeId].salary;
  let upkeep = 0;
  for (const vehicle of state.vehicles) upkeep += getVehicleType(vehicle.typeId).upkeep;
  for (const drone of state.drones) upkeep += DRONE_TYPES[drone.typeId].upkeep;
  return {
    salaries: Math.round(salaries * derived.costMult),
    upkeep: Math.round(upkeep * derived.costMult),
  };
}

/**
 * Recompensa de un pedido. "streakCount" solo se usa en entregas manuales.
 * Devuelve el total y el desglose que se muestra al jugador.
 */
export function computeReward(game, order, { streakCount = 0 } = {}) {
  const { derived } = game;
  const pkg = PACKAGES[order.size];
  const kind = ORDER_KINDS[order.kind];
  const zone = ZONES[order.zoneId];
  const base = pkg.baseReward + order.distanceTiles * pkg.perTile;
  const upgradeMult = derived.rewardMult;
  const reputationMult = derived.reputationRewardMult;
  const streakBonus = streakCount > 1 ? Math.min(streakCount - 1, STREAK_MAX_STEPS) * STREAK_BONUS_PER_STEP : 0;

  let total = base * kind.rewardMult * zone.rewardMult * upgradeMult * reputationMult * (1 + streakBonus);
  const breakdown = [{ label: 'Tarifa base', text: `${formatInt(base)} €` }];
  if (kind.rewardMult !== 1) breakdown.push({ label: kind.short, text: `×${kind.rewardMult.toFixed(1)}` });
  if (zone.rewardMult !== 1) breakdown.push({ label: 'Zona', text: `×${zone.rewardMult.toFixed(2)}` });
  if (upgradeMult !== 1) breakdown.push({ label: 'Mejoras', text: `+${Math.round((upgradeMult - 1) * 100)} %` });
  if (reputationMult > 1.005) breakdown.push({ label: 'Reputación', text: `+${Math.round((reputationMult - 1) * 100)} %` });
  if (streakBonus > 0) breakdown.push({ label: 'Racha', text: `+${Math.round(streakBonus * 100)} %` });
  if (order.late) {
    total *= LATE_REWARD_FACTOR;
    breakdown.push({ label: 'Entrega tardía', text: `-${Math.round((1 - LATE_REWARD_FACTOR) * 100)} %` });
  }
  if (order.damaged) {
    total *= DAMAGED_REWARD_FACTOR;
    breakdown.push({ label: 'Paquete dañado', text: `-${Math.round((1 - DAMAGED_REWARD_FACTOR) * 100)} %` });
  }
  return { total: Math.max(1, Math.round(total)), breakdown, streakBonus };
}

export const rewardPreview = (game, order) => computeReward(game, order).total;
