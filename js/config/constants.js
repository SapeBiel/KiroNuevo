// Constantes globales del juego. No dependen de DOM ni de canvas.

export const TILE = 32; // tamaño de una casilla en píxeles
export const ROAD_WIDTH = 3; // casillas de ancho de cada calle
export const BLOCK_SIZE = 6; // casillas de lado de cada manzana
export const BLOCK_PITCH = ROAD_WIDTH + BLOCK_SIZE; // separación entre calles
export const BLOCKS_X = 8;
export const BLOCKS_Y = 6;
export const MAP_TILES_X = BLOCKS_X * BLOCK_PITCH + ROAD_WIDTH;
export const MAP_TILES_Y = BLOCKS_Y * BLOCK_PITCH + ROAD_WIDTH;
export const MAP_WIDTH_PX = MAP_TILES_X * TILE;
export const MAP_HEIGHT_PX = MAP_TILES_Y * TILE;

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
