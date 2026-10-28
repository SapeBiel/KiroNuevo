// Experiencia, niveles, reputación y desbloqueo de zonas.

import { MAX_LEVEL } from '../config/constants.js';
import { xpToNextLevel, levelTitle, getLevelUnlocks } from '../config/levels.js';
import { ZONES, ZONE_ORDER, ZONE_REQUIRES } from '../config/zones.js';
import { clamp } from '../core/util.js';
import { spend } from './economy.js';

export function addXp(game, amount) {
  const { state } = game;
  const value = Math.max(0, Math.round(amount));
  if (!value) return;
  state.xp += value;
  state.dayStats.xp += value;
  while (state.level < MAX_LEVEL && state.xp >= xpToNextLevel(state.level)) {
    state.xp -= xpToNextLevel(state.level);
    state.level += 1;
    game.recomputeStats();
    game.events.emit('levelUp', { level: state.level, title: levelTitle(state.level), unlocks: getLevelUnlocks(state.level) });
  }
  if (state.level >= MAX_LEVEL) state.xp = Math.min(state.xp, xpToNextLevel(MAX_LEVEL) - 1);
}

export function adjustReputation(game, delta) {
  const { state } = game;
  state.reputation = clamp(state.reputation + delta, 0, 100);
}

export function zoneStatus(game, zoneId) {
  const { state } = game;
  const zone = ZONES[zoneId];
  if (state.zones[zoneId]) return { state: 'unlocked' };
  if (state.level < zone.unlockLevel) return { state: 'locked', reason: `Requiere nivel ${zone.unlockLevel}` };
  const required = ZONE_REQUIRES[zoneId];
  if (required && !state.zones[required]) return { state: 'locked', reason: `Primero desbloquea: ${ZONES[required].name}` };
  if (state.money < zone.unlockCost) return { state: 'poor', reason: 'Fondos insuficientes' };
  return { state: 'available' };
}

export function unlockZone(game, zoneId) {
  const zone = ZONES[zoneId];
  if (!zone) return { ok: false, reason: 'Zona desconocida' };
  const status = zoneStatus(game, zoneId);
  if (status.state === 'unlocked') return { ok: false, reason: 'Ya está desbloqueada' };
  if (status.state !== 'available') return { ok: false, reason: status.reason };
  if (!spend(game, zone.unlockCost)) return { ok: false, reason: 'Fondos insuficientes' };
  game.state.zones[zoneId] = true;
  game.city.setUnlockedZones(game.state.zones);
  game.events.emit('zoneUnlocked', { zoneId });
  game.events.emit('notify', { type: 'success', icon: zone.icon, title: `${zone.name} desbloqueada`, text: zone.description });
  return { ok: true };
}

export const unlockedZoneIds = (state) => ZONE_ORDER.filter((id) => state.zones[id]);
