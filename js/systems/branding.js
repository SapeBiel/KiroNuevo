// Imagen de la empresa elegida por el jugador: nombre, eslogan, logotipo y colores corporativos.
// El nombre sale en la barra superior, en el almacén y en la rotulación de todos los vehículos;
// los colores pintan el logotipo y el almacén y, si se activa, toda la flota.

export const MAX_COMPANY_NAME = 22;
export const MAX_SLOGAN = 32;

export const DEFAULT_COMPANY = Object.freeze({
  name: 'Parcel Empire',
  slogan: '',
  logo: 'box',
  primary: '#ffb703', // carrocería, fondo del logotipo y del rótulo del almacén
  secondary: '#2b2f38', // franja principal
  accent: '#fb8500', // franja secundaria y fondo de los logotipos con icono
  fleetColors: false, // false = cada modelo conserva su pintura original
});

/** Logotipos disponibles: "box" es la caja dibujada original; el resto, un icono sobre el color de detalle. */
export const BRAND_LOGOS = [
  { id: 'box', icon: '📦', label: 'Caja' },
  { id: 'rocket', icon: '🚀', label: 'Cohete' },
  { id: 'bolt', icon: '⚡', label: 'Rayo' },
  { id: 'star', icon: '⭐', label: 'Estrella' },
  { id: 'fox', icon: '🦊', label: 'Zorro' },
  { id: 'bee', icon: '🐝', label: 'Abeja' },
  { id: 'globe', icon: '🌍', label: 'Mundo' },
  { id: 'crown', icon: '👑', label: 'Corona' },
];

/** Combinaciones de colores listas para elegir de un clic. */
export const COLOR_PRESETS = [
  { id: 'classic', label: 'Clásico', primary: '#ffb703', secondary: '#2b2f38', accent: '#fb8500' },
  { id: 'ocean', label: 'Océano', primary: '#1f6fd1', secondary: '#ffffff', accent: '#4cc9f0' },
  { id: 'forest', label: 'Bosque', primary: '#2f8f5b', secondary: '#f4f1de', accent: '#a7d129' },
  { id: 'fire', label: 'Fuego', primary: '#d62828', secondary: '#ffffff', accent: '#f77f00' },
  { id: 'night', label: 'Noche', primary: '#22223b', secondary: '#f2e9e4', accent: '#9a8c98' },
  { id: 'candy', label: 'Chicle', primary: '#e05297', secondary: '#ffffff', accent: '#ffd23f' },
  { id: 'royal', label: 'Real', primary: '#6a4c93', secondary: '#ffca3a', accent: '#ffffff' },
  { id: 'snow', label: 'Nieve', primary: '#f5f3ee', secondary: '#1d3557', accent: '#e63946' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Texto escrito por el jugador: sin caracteres de control, espacios simples y longitud máxima. */
export function cleanBrandText(raw, max) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function isHexColor(value) {
  return typeof value === 'string' && HEX.test(value);
}

export function getLogo(id) {
  return BRAND_LOGOS.find((logo) => logo.id === id) ?? BRAND_LOGOS[0];
}

/** Devuelve siempre una imagen de empresa válida (para partidas antiguas o guardados editados a mano). */
export function sanitizeCompany(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const color = (key) => (isHexColor(source[key]) ? source[key].toLowerCase() : DEFAULT_COMPANY[key]);
  return {
    name: cleanBrandText(source.name, MAX_COMPANY_NAME) || DEFAULT_COMPANY.name,
    slogan: cleanBrandText(source.slogan, MAX_SLOGAN),
    logo: getLogo(source.logo).id,
    primary: color('primary'),
    secondary: color('secondary'),
    accent: color('accent'),
    fleetColors: source.fleetColors === true,
  };
}

/** Imagen actual de la empresa (o la de serie si el estado no la tiene). */
export function getCompany(state) {
  return state?.company ?? DEFAULT_COMPANY;
}

/** Cambia la imagen de la empresa. `changes` puede traer solo algunos campos. */
export function setCompany(game, changes) {
  const current = getCompany(game.state);
  const merged = { ...current, ...changes };
  if (!cleanBrandText(merged.name, MAX_COMPANY_NAME)) return { ok: false, reason: 'Escribe el nombre de la empresa' };
  for (const key of ['primary', 'secondary', 'accent']) {
    if (!isHexColor(merged[key])) return { ok: false, reason: 'Color no válido' };
  }
  const company = sanitizeCompany(merged);
  game.state.company = company;
  game.events.emit('companyChanged', { company, previous: current });
  return { ok: true, company };
}

/** Luminancia relativa (0 = negro, 1 = blanco) de un color #rrggbb. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Color de texto legible sobre un fondo: oscuro sobre colores claros y blanco sobre oscuros. */
export function contrastText(hex) {
  return luminance(isHexColor(hex) ? hex : '#ffffff') > 0.36 ? '#1f2633' : '#ffffff';
}

/** Nombre tal y como se rotula (en mayúsculas). */
export function brandTitle(company) {
  return getCompanyName(company).toLocaleUpperCase('es-ES');
}

export function getCompanyName(company) {
  return company?.name || DEFAULT_COMPANY.name;
}

/** Web inventada para la rotulación del camión, a partir del nombre ("Envíos Pepe" → enviospepe.es). */
export function companyWebsite(company) {
  const slug = getCompanyName(company)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  return `${slug || 'miempresa'}.es`;
}

/** Clave corta que cambia cuando cambia algo visible de la imagen (para las cachés de texturas). */
export function companyKey(company) {
  const c = company ?? DEFAULT_COMPANY;
  const text = [c.name, c.slogan, c.logo, c.primary, c.secondary, c.accent, c.fleetColors].join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
