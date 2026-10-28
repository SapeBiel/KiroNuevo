// Utilidades de DOM: actualización incremental de HTML que conserva los elementos existentes.
// Así los botones no se recrean mientras el usuario los pulsa y no se pierden clics ni foco.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function syncAttributes(from, to) {
  for (const attr of [...from.attributes]) {
    if (!to.hasAttribute(attr.name)) from.removeAttribute(attr.name);
  }
  for (const attr of [...to.attributes]) {
    if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
  }
}

function patchNode(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) {
    from.replaceWith(to.cloneNode(true));
    return;
  }
  if (from.nodeType === Node.TEXT_NODE || from.nodeType === Node.COMMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  syncAttributes(from, to);
  morphChildren(from, to);
}

function morphChildren(from, to) {
  const target = [...to.childNodes];
  const common = Math.min(from.childNodes.length, target.length);
  for (let i = 0; i < common; i++) patchNode(from.childNodes[i], target[i]);
  while (from.childNodes.length > target.length) from.removeChild(from.lastChild);
  for (let i = common; i < target.length; i++) from.appendChild(target[i].cloneNode(true));
}

/** Sustituye el contenido de "container" por "html" modificando solo lo que ha cambiado. */
export function setHtml(container, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  morphChildren(container, template.content);
}

export function setText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

export function setStyle(element, property, value) {
  if (element && element.style[property] !== value) element.style[property] = value;
}

/** Delegación de clics para elementos con data-action. */
export function onAction(root, handler) {
  root.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    if (el.getAttribute('aria-disabled') === 'true') {
      // Se deja que el juego explique por qué no se puede (data-reason)
      const reason = el.getAttribute('data-reason');
      if (reason) handler('blocked', { reason, ...el.dataset });
      return;
    }
    handler(el.dataset.action, el.dataset, el);
  });
}

/** Barra de progreso en HTML. */
export function bar(percent, className = '') {
  return `<div class="bar ${className}"><i style="width:${Math.max(0, Math.min(100, percent)).toFixed(1)}%"></i></div>`;
}
