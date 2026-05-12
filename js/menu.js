import { state } from './state.js';
import { render } from './score.js';

export function initMenu() {
  const menuBtn  = document.getElementById('menu-btn');
  const sideMenu = document.getElementById('side-menu');
  const backdrop = document.getElementById('backdrop');
  const bplInput = document.getElementById('bpl-input');
  const bplAlert = document.getElementById('bpl-alert');

  // ── Bars-per-line input ───────────────────────────────────────────────────
  bplInput.addEventListener('change', () => {
    const raw = bplInput.value.trim();
    if (raw === '') { bplAlert.classList.add('hidden'); return; }

    const val = parseInt(raw, 10);
    if (isNaN(val) || val < 2 || val > 8) {
      bplAlert.classList.remove('hidden');
      bplInput.value = '';
      return;
    }

    bplAlert.classList.add('hidden');
    state.barsPerRow = val;
    render();
  });

  // ── Menu open / close ─────────────────────────────────────────────────────
  menuBtn.addEventListener('click', () => {
    const isOpen = !sideMenu.classList.contains('-translate-x-full');
    sideMenu.classList.toggle('-translate-x-full', isOpen);
    sideMenu.classList.toggle('translate-x-0', !isOpen);
    backdrop.classList.toggle('hidden', isOpen);
  });

  backdrop.addEventListener('click', () => {
    sideMenu.classList.add('-translate-x-full');
    sideMenu.classList.remove('translate-x-0');
    backdrop.classList.add('hidden');
  });
}
