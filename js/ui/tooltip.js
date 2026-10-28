// Tooltip global: cualquier elemento con data-tip muestra una explicación breve.

export function initTooltip(tooltip) {
  let current = null;

  const hide = () => {
    current = null;
    tooltip.classList.remove('is-visible');
  };

  const show = (target) => {
    const text = target.getAttribute('data-tip');
    if (!text) { hide(); return; }
    current = target;
    tooltip.textContent = text;
    tooltip.classList.add('is-visible');
    const rect = target.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tip.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - tip.width - 8, left));
    let top = rect.top - tip.height - 10;
    if (top < 8) top = rect.bottom + 10;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  document.addEventListener('pointerover', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (target) show(target); else hide();
  });
  document.addEventListener('focusin', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (target) show(target);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  window.addEventListener('scroll', hide, true);
  setInterval(() => {
    if (current && !current.isConnected) hide();
    else if (current && tooltip.textContent !== current.getAttribute('data-tip')) show(current);
  }, 400);
}
