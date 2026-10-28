/** Generador pseudoaleatorio determinista (mulberry32). */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;
export const randomFloat = (rng, min, max) => rng() * (max - min) + min;
export const choice = (rng, array) => array[Math.floor(rng() * array.length)];

export function weightedChoice(rng, items, weightOf) {
  let total = 0;
  for (const item of items) total += Math.max(0, weightOf(item));
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
