// Compra de mejoras: costes, requisitos y efectos (los efectos se calculan en stats.js).

import { UPGRADES } from '../config/upgrades.js';
import { MAX_LEVEL } from '../config/constants.js';
import { formatMoney } from '../core/util.js';
import { spend } from './economy.js';

export function upgradeCost(def, currentLevel) {
  if (def.costs) return def.costs[currentLevel];
  if (def.cost !== undefined) return def.cost;
  return Math.round((def.baseCost * Math.pow(def.growth, currentLevel)) / 5) * 5;
}

export function requiredLevelFor(def, currentLevel) {
  return def.levelReqs ? def.levelReqs[currentLevel] : def.unlockLevel;
}

export function getUpgradeStatus(game, def) {
  const { state } = game;
  const level = state.upgrades[def.id] ?? 0;
  if (level >= def.maxLevel) return { level, state: 'maxed', cost: 0, reason: 'Nivel máximo' };
  const cost = upgradeCost(def, level);
  const needed = requiredLevelFor(def, level);
  if (state.level < Math.min(needed, MAX_LEVEL)) return { level, state: 'locked', cost, reason: `Requiere nivel ${needed}` };
  for (const req of def.requires ?? []) {
    if ((state.upgrades[req.id] ?? 0) < req.level) {
      const requiredDef = UPGRADES[req.id];
      return { level, state: 'locked', cost, reason: `Requiere: ${requiredDef.name}${requiredDef.maxLevel > 1 ? ` (nivel ${req.level})` : ''}` };
    }
  }
  if (state.money < cost) return { level, state: 'poor', cost, reason: `Te faltan ${formatMoney(cost - state.money)}` };
  return { level, state: 'available', cost, reason: '' };
}

export function buyUpgrade(game, id) {
  const def = UPGRADES[id];
  if (!def) return { ok: false, reason: 'Mejora desconocida' };
  const status = getUpgradeStatus(game, def);
  if (status.state === 'maxed' || status.state === 'locked' || status.state === 'poor') return { ok: false, reason: status.reason };
  if (!spend(game, status.cost)) return { ok: false, reason: 'Fondos insuficientes' };
  game.state.upgrades[id] = status.level + 1;
  game.recomputeStats();
  game.events.emit('upgradePurchased', { id, level: status.level + 1, def });
  return { ok: true };
}
