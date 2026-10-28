import { MAX_LEVEL } from './constants.js';
import { UPGRADES } from './upgrades.js';
import { VEHICLES } from './vehicles.js';
import { WORKER_TYPES } from './workers.js';
import { ZONES } from './zones.js';
import { ORDER_KINDS } from './packages.js';

/** Experiencia necesaria para pasar del nivel indicado al siguiente. */
export function xpToNextLevel(level) {
  return Math.round(28 * Math.pow(level, 1.6));
}

const TITLES = [
  'Repartidor novato', 'Mensajero local', 'Pequeña empresa', 'Operador urbano', 'Empresa regional',
  'Operador logístico', 'Gran operador', 'Empresa tecnológica', 'Líder logístico', 'Red metropolitana',
  'Gigante del reparto', 'Imperio logístico', 'Corporación global', 'Referente mundial', 'Leyenda del reparto',
];

export function levelTitle(level) {
  return TITLES[Math.min(level, TITLES.length) - 1] ?? TITLES[TITLES.length - 1];
}

/** Lista legible de lo que se desbloquea al alcanzar un nivel (generada desde la configuración). */
export function getLevelUnlocks(level) {
  const lines = [];
  for (const kind of Object.values(ORDER_KINDS)) {
    if (!kind.requiresUpgrade && kind.minLevel === level && level > 1) lines.push(`Pedidos: ${kind.label.toLowerCase()}`);
  }
  for (const zone of Object.values(ZONES)) {
    if (zone.unlockLevel === level && level > 1) lines.push(`Zona: ${zone.name}`);
  }
  for (const vehicle of Object.values(VEHICLES)) {
    if (vehicle.unlockLevel === level) lines.push(`Vehículo: ${vehicle.name}`);
  }
  for (const worker of Object.values(WORKER_TYPES)) {
    if (worker.unlockLevel === level) lines.push(`Empleado: ${worker.name}`);
  }
  for (const upgrade of Object.values(UPGRADES)) {
    const firstLevel = upgrade.levelReqs ? upgrade.levelReqs[0] : upgrade.unlockLevel;
    if (firstLevel === level && level > 1) lines.push(`Mejora: ${upgrade.name}`);
  }
  return lines;
}

export { MAX_LEVEL };
