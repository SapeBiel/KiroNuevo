// Ventanas modales: bienvenida, resumen de jornada, menú, ayuda y confirmaciones.

import { escapeHtml, formatInt, formatMoney } from '../core/util.js';
import { levelTitle } from '../config/levels.js';
import { BRAND_LOGOS, COLOR_PRESETS, MAX_COMPANY_NAME, MAX_SLOGAN } from '../systems/branding.js';

export class ModalManager {
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.stack = [];
  }

  get isOpen() {
    return this.stack.length > 0;
  }

  open({ id, title, html, className = '', dismissable = true, onClose = null, onAction = null }) {
    if (id && this.stack.some((m) => m.id === id)) return null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-body">${html}</div></div>`;
    const entry = { id, overlay, dismissable, onClose, previousFocus: document.activeElement };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && dismissable) this.close(entry);
      const actionEl = e.target.closest('[data-modal-action]');
      if (actionEl) {
        const action = actionEl.dataset.modalAction;
        if (action === 'close') this.close(entry);
        else onAction?.(action, entry, actionEl);
      }
    });
    this.root.appendChild(overlay);
    this.stack.push(entry);
    overlay.querySelector('[data-autofocus], button')?.focus();
    this.onChange(this.stack.length);
    return entry;
  }

  close(entry) {
    const index = this.stack.indexOf(entry);
    if (index < 0) return;
    this.stack.splice(index, 1);
    entry.overlay.remove();
    entry.previousFocus?.focus?.({ preventScroll: true });
    entry.onClose?.();
    this.onChange(this.stack.length);
  }

  closeById(id) {
    const entry = this.stack.find((m) => m.id === id);
    if (entry) this.close(entry);
  }

  /** Cierra la ventana superior si se puede descartar. Devuelve true si cerró algo. */
  closeTop() {
    const entry = this.stack[this.stack.length - 1];
    if (!entry || !entry.dismissable) return false;
    this.close(entry);
    return true;
  }
}

export function welcomeHtml() {
  return `
    <div class="modal-hero" aria-hidden="true">📦🚐🏡</div>
    <h2>Parcel Empire</h2>
    <p class="modal-lead">Eres el dueño de una pequeña empresa de mensajería. Tienes un almacén, una furgoneta y un primer pedido.
    Entrega paquetes, reinvierte las ganancias y convierte tu negocio en una gran red logística con empleados, camiones y drones.</p>
    <p class="modal-lead">Empiezas a pie dentro del almacén: recoge los productos de la cinta transportadora, empaquétalos en la mesa,
    registra la caja en expedición, cárgala en la furgoneta, conduce hasta el destino y llévala andando hasta la puerta.</p>
    <div class="controls-grid">
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <span>Andar a pie · conducir al volante</span></div>
      <div>Ratón <span>Mirar en primera persona (haz clic en la vista; Esc lo suelta)</span></div>
      <div><kbd>E</kbd> <span>Coger, dejar, empaquetar, cargar, entregar · subir y bajar del vehículo</span></div>
      <div><kbd>Espacio</kbd> <span>Saltar a pie · derrapar al volante</span></div>
      <div><kbd>Mayús</kbd> <span>Correr a pie</span></div>
      <div>🖥️ <span>La gestión (pedidos, mejoras, equipo, empresa) se hace en el ordenador de la oficina: <kbd>E</kbd> junto a la mesa</span></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-lg" data-modal-action="brand">🎨 Ponle nombre y colores a tu empresa</button>
      <button class="btn btn-primary btn-lg" data-modal-action="start" data-autofocus>¡Empezar a repartir!</button>
    </div>`;
}

export function helpHtml() {
  return `
    <h2>Cómo se juega</h2>
    <ol class="help-list">
      <li><b>Ordenador de la oficina:</b> toda la gestión se hace desde él. Entra en la oficina acristalada (esquina del fondo a la izquierda del almacén) y pulsa <kbd>E</kbd> junto a la mesa. Tiene las aplicaciones Pedidos, Mejoras, Equipo, Empresa y Logros (teclas <kbd>1</kbd>–<kbd>5</kbd> con el ordenador encendido). Fuera de la oficina, la tarjeta <i>En las manos</i> te dice qué productos faltan del pedido.</li>
      <li><b>Cinta transportadora:</b> los productos de los pedidos salen de recepción y avanzan por la cinta. Ponte junto a ella, mira el producto y pulsa <kbd>E</kbd> para cogerlo. Los voluminosos llenan las manos. Si no lo coges, cae al cajón del final de la cinta y lo puedes coger de ahí.</li>
      <li><b>Empaquetar:</b> lleva los productos a tu mesa (la del centro), <kbd>E</kbd> para dejarlos y <kbd>E</kbd> otra vez para cerrar la caja. Un pedido con varios productos necesita todos en la mesa.</li>
      <li><b>Expedición:</b> lleva la caja a la estantería de expedición, junto a la fachada, y pulsa <kbd>E</kbd> para registrarla. Desde ahí la coges para cargarla (y también la pueden llevar tus repartidores o drones).</li>
      <li><b>Cargar y conducir:</b> sal por la puerta peatonal, <kbd>E</kbd> en la trasera de la furgoneta para cargar la caja y <kbd>E</kbd> en la puerta del conductor para subir. Ve al pin de color del destino y aparca en su círculo.</li>
      <li><b>Entregar:</b> <kbd>E</kbd> para bajarte, <kbd>E</kbd> en la trasera para sacar la caja y llévala hasta la puerta del destinatario. Allí, <kbd>E</kbd> para cobrar.</li>
      <li><b>Preparadores:</b> desde el nivel 4 puedes contratarlos (ordenador de la oficina → Equipo). Trabajan en su puesto del almacén: recogen productos del cajón de la cinta, empaquetan y dejan la caja en expedición. Nunca tocan lo que estás preparando tú.</li>
      <li><b>Derrape:</b> al volante y a buena velocidad, gira y mantén <kbd>Espacio</kbd>. Si derrapas más de medio segundo y sueltas sin chocar, ganas un turbo.</li>
      <li><b>Urgentes:</b> pagan más, pero tienen límite de tiempo. Si llegas tarde cobras menos, nunca pierdes dinero.</li>
      <li><b>Rachas:</b> encadena entregas a tiempo para ganar hasta un +32 % extra.</li>
      <li><b>Mejoras y empleados:</b> mejora el vehículo, el almacén y la empresa y contrata repartidores para que entreguen solos, todo desde el ordenador de la oficina.</li>
      <li><b>Ciudad y drones:</b> desbloquea barrios en el ordenador (Empresa); desde el nivel 8 puedes investigar los drones.</li>
    </ol>
    <div class="controls-grid">
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / flechas <span>Andar a pie · conducir al volante</span></div>
      <div>Ratón o <kbd>←</kbd><kbd>→</kbd> <span>Mirar y girar a pie (clic para capturar el ratón)</span></div>
      <div><kbd>E</kbd> <span>Interactuar con lo que tienes delante</span></div>
      <div><kbd>Espacio</kbd> <span>Saltar a pie · derrapar al volante</span></div>
      <div><kbd>Mayús</kbd> <span>Correr a pie</span></div>
      <div><kbd>1</kbd>–<kbd>5</kbd> <span>En el ordenador: Pedidos, Mejoras, Equipo, Empresa, Logros</span></div>
      <div><kbd>M</kbd> <span>Sonido</span></div>
      <div><kbd>C</kbd> <span>Cámara del vehículo: exterior / conductor / aérea (rueda: zoom)</span></div>
      <div><kbd>P</kbd> <span>Menú / pausa</span></div>
      <div><kbd>Esc</kbd> <span>Soltar el ratón o cerrar ventana</span></div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" data-modal-action="close" data-autofocus>Entendido</button></div>`;
}

const GRAPHICS_LABELS = { alta: 'Alta (brillos y sombras finas)', media: 'Media', baja: 'Baja (equipos lentos)' };

export function menuHtml({ sound, graphics = 'alta' }) {
  return `
    <h2>Menú</h2>
    <p class="muted">El juego está en pausa mientras este menú está abierto. La partida se guarda automáticamente.</p>
    <div class="menu-list">
      <button class="btn btn-primary" data-modal-action="close" data-autofocus>▶ Continuar</button>
      <button class="btn" data-modal-action="save">💾 Guardar ahora</button>
      <button class="btn" data-modal-action="sound">${sound ? '🔊 Sonido: activado' : '🔇 Sonido: desactivado'}</button>
      <button class="btn" data-modal-action="brand">🏷️ Nombre, logotipo y colores de la empresa</button>
      <button class="btn" data-modal-action="graphics">🎨 Gráficos 3D: ${GRAPHICS_LABELS[graphics] ?? GRAPHICS_LABELS.alta}</button>
      <button class="btn" data-modal-action="help">❓ Cómo se juega</button>
      <button class="btn btn-danger" data-modal-action="reset">🗑 Reiniciar partida</button>
    </div>`;
}

export function renameHtml({ name, icon, typeName, maxLength }) {
  return `
    <h2>${icon} Cambiar nombre</h2>
    <p class="muted">${escapeHtml(typeName)} · ahora se llama <b>${escapeHtml(name)}</b>.</p>
    <label class="field">
      <span>Nuevo nombre</span>
      <input class="text-input" id="rename-input" type="text" maxlength="${maxLength}" autocomplete="off" spellcheck="false"
        value="${escapeHtml(name)}" data-autofocus aria-describedby="rename-error">
    </label>
    <p class="form-error" id="rename-error" role="alert"></p>
    <div class="modal-actions">
      <button class="btn" data-modal-action="close">Cancelar</button>
      <button class="btn btn-primary" data-modal-action="save-name">Guardar</button>
    </div>`;
}

/** Ventana de imagen de empresa: nombre, eslogan, logotipo y colores, con vista previa de la furgoneta. */
export function brandingHtml(company) {
  const logos = BRAND_LOGOS.map((logo) => `
    <button type="button" class="logo-option" data-modal-action="brand-logo" data-id="${logo.id}"
      aria-pressed="${logo.id === company.logo}" aria-label="Logotipo: ${logo.label}" data-tip="${logo.label}">${logo.icon}</button>`).join('');
  const presets = COLOR_PRESETS.map((p) => `
    <button type="button" class="preset-option" data-modal-action="brand-preset" data-id="${p.id}" aria-label="Colores ${p.label}">
      <span class="swatches" aria-hidden="true"><i style="background:${p.primary}"></i><i style="background:${p.secondary}"></i><i style="background:${p.accent}"></i></span>
      <small>${p.label}</small></button>`).join('');
  const color = (id, label, value) => `
    <label class="color-field"><input type="color" id="brand-${id}" value="${value}"><span>${label}</span></label>`;
  return `
    <h2>🎨 Imagen de la empresa</h2>
    <p class="muted">El nombre y el logotipo salen en la barra superior, en el almacén y en la rotulación de todos tus vehículos.</p>
    <div class="brand-editor">
      <div class="brand-form">
        <label class="field">
          <span>Nombre de la empresa</span>
          <input class="text-input" id="brand-name-input" type="text" maxlength="${MAX_COMPANY_NAME}" autocomplete="off" spellcheck="false"
            value="${escapeHtml(company.name)}" data-autofocus aria-describedby="brand-error">
        </label>
        <label class="field">
          <span>Eslogan <small class="muted">(opcional, va en los laterales de las furgonetas)</small></span>
          <input class="text-input" id="brand-slogan-input" type="text" maxlength="${MAX_SLOGAN}" autocomplete="off"
            value="${escapeHtml(company.slogan)}" placeholder="Ej.: Llegamos antes que nadie">
        </label>
        <fieldset class="brand-fieldset">
          <legend>Logotipo</legend>
          <div class="logo-picker">${logos}</div>
        </fieldset>
        <fieldset class="brand-fieldset">
          <legend>Colores</legend>
          <div class="preset-picker">${presets}</div>
          <div class="color-row">
            ${color('primary', 'Principal', company.primary)}
            ${color('secondary', 'Franja', company.secondary)}
            ${color('accent', 'Detalle', company.accent)}
          </div>
          <label class="check-field"><input type="checkbox" id="brand-fleet" ${company.fleetColors ? 'checked' : ''}>
            <span>Pintar toda la flota con estos colores <small class="muted">(si no, cada modelo conserva su pintura)</small></span></label>
        </fieldset>
      </div>
      <figure class="brand-preview">
        <canvas id="brand-preview" width="360" height="200" role="img" aria-label="Vista previa de la furgoneta con la imagen de la empresa"></canvas>
        <figcaption class="muted">Vista previa</figcaption>
      </figure>
    </div>
    <p class="form-error" id="brand-error" role="alert"></p>
    <div class="modal-actions">
      <button class="btn" data-modal-action="close">Cancelar</button>
      <button class="btn btn-primary" data-modal-action="save-brand">Guardar</button>
    </div>`;
}

export function confirmResetHtml() {
  return `
    <h2>¿Reiniciar la partida?</h2>
    <p>Perderás todo tu progreso: dinero, mejoras, empleados, vehículos, drones y zonas desbloqueadas. <b>Esta acción no se puede deshacer.</b></p>
    <div class="modal-actions">
      <button class="btn" data-modal-action="close" data-autofocus>Cancelar</button>
      <button class="btn btn-danger" data-modal-action="confirm-reset">Sí, borrar todo y empezar de nuevo</button>
    </div>`;
}

export function summaryHtml(s) {
  const stars = '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars);
  const row = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${value}</td></tr>`;
  const expenses = s.fuel + s.salaries + s.upkeep;
  return `
    <div class="modal-hero small" aria-hidden="true">🌅</div>
    <h2>Resumen de la jornada ${s.day}</h2>
    <div class="stars" aria-label="Valoración: ${s.stars} de 3 estrellas">${stars}</div>
    <table class="summary-table">
      ${row('Entregas completadas', formatInt(s.deliveries))}
      ${row('Pedidos tardíos', formatInt(s.late))}
      ${row('Mejor racha', formatInt(s.bestStreak))}
      ${row('Ingresos', `+${formatMoney(s.income)}`, 'is-positive')}
      ${row('Combustible', `-${formatMoney(s.fuel)}`, 'is-negative')}
      ${row('Sueldos', `-${formatMoney(s.salaries)}`, 'is-negative')}
      ${row('Mantenimiento', `-${formatMoney(s.upkeep)}`, 'is-negative')}
      ${row('Gastos totales', `-${formatMoney(expenses)}`, 'is-negative total')}
      ${row('Beneficio neto', `${s.net >= 0 ? '+' : ''}${formatMoney(s.net)}`, `${s.net >= 0 ? 'is-positive' : 'is-negative'} total`)}
    </table>
    ${s.unpaid > 0 ? `<p class="callout warn">No pudiste pagar ${formatMoney(s.unpaid)} de gastos: tu reputación ha bajado.</p>` : ''}
    <p class="muted">Nivel ${s.level} · ${levelTitle(s.level)} · Saldo: ${formatMoney(s.money)}</p>
    <div class="modal-actions"><button class="btn btn-primary btn-lg" data-modal-action="next-day" data-autofocus>Empezar la jornada ${s.day + 1}</button></div>`;
}
