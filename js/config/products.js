// Catálogo del almacén. Cada producto tiene una categoría (A-F, la estantería donde se almacena), una forma
// 3D, un tamaño en píxeles del mapa [ancho, alto, fondo], colores y un volumen ("bulk") que limita cuántos
// se pueden llevar en las manos. Los pedidos traen una lista de productos que llegan por la cinta
// transportadora, se llevan a la mesa y se empaquetan.

export const SHELVES = [
  { id: 'A', name: 'Libros y papelería', color: '#4cc9f0' },
  { id: 'B', name: 'Electrónica', color: '#7b8cff' },
  { id: 'C', name: 'Moda y deporte', color: '#f78fb3' },
  { id: 'D', name: 'Hogar y cocina', color: '#90be6d' },
  { id: 'E', name: 'Voluminosos', color: '#f9844a' },
  { id: 'F', name: 'Frágil y especial', color: '#b980f0' },
];

/**
 * Formas disponibles (ver render3d/products3d.js): book, envelope, folder, box, appliance, toolbox, case,
 * bottle, jar, vase, soft, backpack, shoebox, flat, frame, tube, lamp, bike, pallet, crate, longbox, guitar.
 */
const P = (shelf, shape, size, color, accent = '#ffffff', bulk = 1) => ({ shelf, shape, size, color, accent, bulk });

export const PRODUCTS = {
  // A · Libros y papelería
  'Libro': P('A', 'book', [3.4, 0.9, 4.6], '#2a6f97', '#f4ecd8'),
  'Libro de bienvenida': P('A', 'book', [3.6, 1.2, 4.8], '#ffb703', '#fff8e8'),
  'Cartas certificadas': P('A', 'envelope', [4.4, 0.35, 3.0], '#f6f1e3', '#d62828'),
  'Documentos urgentes': P('A', 'folder', [4.2, 0.8, 5.0], '#d62828', '#ffffff'),
  'Contrato firmado': P('A', 'folder', [3.8, 0.5, 4.8], '#355070', '#ffd166'),
  'Suministros de oficina': P('A', 'box', [5.0, 3.4, 4.0], '#c99a62', '#4cc9f0'),
  'Material de embalaje': P('A', 'tube', [1.8, 1.8, 6.0], '#a0a7b4', '#e8c48e'),
  // B · Electrónica
  'Auriculares': P('B', 'case', [3.4, 1.8, 3.4], '#1d2230', '#7b8cff'),
  'Videojuego': P('B', 'case', [2.8, 0.5, 3.8], '#0a64c2', '#ffffff'),
  'Altavoz': P('B', 'jar', [2.8, 4.2, 2.8], '#2b2d42', '#8d99ae'),
  'Pieza de repuesto': P('B', 'box', [3.2, 2.2, 3.2], '#6c757d', '#ffb703'),
  'Equipo médico': P('B', 'case', [4.6, 2.4, 3.4], '#f1f3f5', '#e63946'),
  // C · Moda y deporte
  'Camiseta': P('C', 'soft', [4.2, 1.0, 3.6], '#f78fb3', '#ffffff'),
  'Gafas de sol': P('C', 'case', [3.0, 1.2, 1.4], '#22223b', '#c9ada7'),
  'Zapatillas': P('C', 'shoebox', [5.2, 2.4, 3.2], '#ef476f', '#ffffff'),
  'Mochila': P('C', 'backpack', [3.6, 4.6, 2.4], '#06d6a0', '#073b4c'),
  'Cosmética': P('C', 'bottle', [1.4, 3.2, 1.4], '#ffafcc', '#ffffff'),
  // D · Hogar y cocina
  'Llaves de repuesto': P('D', 'case', [2.0, 0.6, 1.6], '#adb5bd', '#ffd166'),
  'Cafetera': P('D', 'appliance', [3.6, 4.6, 3.4], '#343a40', '#e9c46a', 2),
  'Caja de herramientas': P('D', 'toolbox', [5.2, 2.8, 2.6], '#d62828', '#212529', 2),
  'Batidora': P('D', 'jar', [2.4, 5.0, 2.4], '#e9ecef', '#90be6d'),
  'Lámpara de mesa': P('D', 'lamp', [3.2, 5.4, 3.2], '#f4a261', '#fff1c1'),
  'Juego de sábanas': P('D', 'soft', [4.6, 1.8, 3.8], '#a8dadc', '#ffffff'),
  'Medicamentos': P('D', 'box', [2.6, 1.6, 1.8], '#ffffff', '#2a9d8f'),
  // E · Voluminosos (llenan las manos)
  'Lavadora': P('E', 'appliance', [6.0, 7.0, 6.0], '#f8f9fa', '#457b9d', 3),
  'Sofá desmontado': P('E', 'longbox', [11.0, 3.2, 5.0], '#8d6e63', '#e8c48e', 3),
  'Bicicleta': P('E', 'bike', [10.0, 6.4, 1.6], '#e63946', '#212529', 3),
  'Televisor 65"': P('E', 'flat', [10.0, 6.0, 1.0], '#1b1b1f', '#4895ef', 3),
  'Estantería': P('E', 'longbox', [10.0, 1.8, 3.6], '#c99a62', '#6b4a32', 3),
  'Palé de material': P('E', 'pallet', [7.0, 4.6, 7.0], '#c99a62', '#2a9d8f', 3),
  'Maquinaria ligera': P('E', 'crate', [6.0, 4.4, 5.0], '#b08968', '#495057', 3),
  'Palé comercial': P('E', 'pallet', [7.0, 4.0, 7.0], '#c99a62', '#ffb703', 3),
  'Mercancía para tienda': P('E', 'box', [6.0, 4.6, 5.0], '#c99a62', '#ef476f', 2),
  // F · Frágil y especial
  'Jarrón de cristal': P('F', 'vase', [2.6, 4.8, 2.6], '#90e0ef', '#caf0f8'),
  'Cuadro enmarcado': P('F', 'frame', [5.6, 4.4, 0.6], '#8d5524', '#ffd166', 2),
  'Vajilla de porcelana': P('F', 'box', [4.6, 3.2, 4.6], '#f8f9fa', '#b980f0', 2),
  'Monitor 4K': P('F', 'flat', [6.4, 4.0, 0.9], '#212529', '#4cc9f0', 2),
  'Instrumento musical': P('F', 'guitar', [3.2, 1.6, 9.0], '#6f1d1b', '#f4a261', 2),
};

const FALLBACK = P('D', 'box', [3.4, 2.6, 3.4], '#c99a62', '#ffffff');

/** Datos de un producto (los nombres desconocidos se dibujan como una caja genérica de su categoría). */
export function productInfo(name) {
  const known = PRODUCTS[name];
  if (known) return known;
  return { ...FALLBACK, shelf: shelfOf(name), color: getShelf(shelfOf(name)).color };
}

/** Estantería de un producto (los nombres desconocidos se reparten de forma estable). */
export function shelfOf(name) {
  if (PRODUCTS[name]) return PRODUCTS[name].shelf;
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SHELVES[hash % SHELVES.length].id;
}

export const getShelf = (id) => SHELVES.find((s) => s.id === id) ?? SHELVES[0];

/** Cuántos productos lleva un pedido según el tamaño de la caja final [mínimo, máximo]. */
export const ITEMS_BY_SIZE = { small: [1, 1], medium: [1, 2], large: [2, 3] };

/** Volumen que cabe en las manos (un producto voluminoso las llena). */
export const HAND_CAPACITY = 3;
/** Máximo de productos sueltos en las manos (para validar partidas guardadas). */
export const HAND_ITEM_LIMIT = 3;

/** Medidas de la caja terminada según su tamaño [ancho, alto, fondo]. */
export const BOX_SIZES = {
  small: [5.0, 3.6, 4.4],
  medium: [7.0, 5.0, 6.0],
  large: [11.0, 7.6, 9.0],
};

/**
 * Medidas reales de la caja de un pedido [largo (x), alto, ancho (z)]: parte de la medida de su tamaño y crece
 * si algún producto no cabría (un sofá desmontado necesita una caja alargada). Los productos van tumbados.
 */
export function boxSizeFor(order) {
  const base = BOX_SIZES[order?.size] ?? BOX_SIZES.medium;
  let long = Math.max(base[0], base[2]);
  let short = Math.min(base[0], base[2]);
  let high = base[1];
  let stack = 0;
  for (const item of order?.items ?? []) {
    const [a, b, c] = [...productInfo(item.name).size].sort((x, y) => y - x);
    long = Math.max(long, a + 0.8);
    short = Math.max(short, b + 0.8);
    stack += c;
  }
  high = Math.max(high, Math.min(stack + 0.8, 14));
  return [long, high, short];
}

/** Dónde está cada producto, para la interfaz: [icono, texto]. */
export const ITEM_AT_LABELS = {
  queued: ['🕓', 'Saliendo de recepción'],
  belt: ['➡️', 'En la cinta'],
  bin: ['🧺', 'En el cajón de la cinta'],
  hand: ['✋', 'En tus manos'],
  worker: ['🧑‍🏭', 'Lo lleva un preparador'],
  table: ['✅', 'En la mesa'],
  box: ['📦', 'Empaquetado'],
};
