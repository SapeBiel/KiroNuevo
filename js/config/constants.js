// Constantes globales del juego. No dependen de DOM ni de canvas.

export const TILE = 32; // tamaño de una casilla en píxeles
// La ciudad se genera con una semilla: manzanas y calles de tamaño variable (ver world/cityMap.js).
// El tamaño real del mapa en casillas está en city.width / city.height.
export const CITY_BLOCKS_X = 11; // columnas de manzanas
export const CITY_BLOCKS_Y = 8; // filas de manzanas
export const DEFAULT_CITY_SEED = 20240607; // semilla de las pruebas automáticas
export const CITY_LAYOUT_VERSION = 2; // sube si cambia el generador: las partidas viejas se recolocan

export const METERS_PER_TILE = 12; // para mostrar distancias en metros

export const DAY_LENGTH = 300; // segundos reales que dura una jornada completa (24 h de juego)
export const DAY_START_HOUR = 6; // la jornada empieza a las 06:00

export const DROP_RADIUS = 72; // radio (px) de la zona de entrega junto a cada edificio
export const DEPOT_RADIUS = 112; // radio (px) de la zona del almacén

export const STREAK_WINDOW = 60; // segundos para encadenar entregas
export const STREAK_BONUS_PER_STEP = 0.04;
export const STREAK_MAX_STEPS = 8;

export const FUEL_COST_PER_TILE = 0.08; // € por casilla recorrida (furgoneta básica)
export const LATE_REWARD_FACTOR = 0.55;
export const DAMAGED_REWARD_FACTOR = 0.6;
export const CRASH_DAMAGE_SPEED = 85; // velocidad de impacto que daña un envío frágil

export const MAX_LEVEL = 15;
export const START_MONEY = 50;
export const START_REPUTATION = 30;

export const AUTOSAVE_INTERVAL = 8; // segundos
export const SAVE_KEY = 'parcel-empire-delivery-tycoon:save:v1';
export const SETTINGS_KEY = 'parcel-empire-delivery-tycoon:settings:v1';
export const SAVE_VERSION = 1;
