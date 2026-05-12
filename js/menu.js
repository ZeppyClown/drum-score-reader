import { state } from './state.js';
import { render } from './score.js';

// ── Side menu initialisation ──────────────────────────────────────────────────
// The side menu slides in from the left when the ☰ button is clicked.
// It currently holds one control: "bars per line" (how many bars fit on each row).
export function initMenu() {
  const menuBtn  = document.getElementById('menu-btn');
  const sideMenu = document.getElementById('side-menu');
  const backdrop = document.getElementById('backdrop');  // full-screen overlay behind the menu
  const bplInput = document.getElementById('bpl-input');
  const bplAlert = document.getElementById('bpl-alert'); // warning shown for invalid values

  // ── Bars-per-line input ───────────────────────────────────────────────────
  // Valid range is 2–8. Anything outside that shows a warning and clears the field.
  // On a valid value, update state.barsPerRow and re-render so the layout changes immediately.
  bplInput.addEventListener('change', () => {
    const raw = bplInput.value.trim();
    if (raw === '') { bplAlert.classList.add('hidden'); return; }  // cleared, dismiss alert

    const val = parseInt(raw, 10);
    if (isNaN(val) || val < 2 || val > 8) {
      bplAlert.classList.remove('hidden');  // show "Only values between 2 and 8 are accepted"
      bplInput.value = '';
      return;
    }

    bplAlert.classList.add('hidden');
    state.barsPerRow = val;
    render();  // immediately reflow bars into the new number of columns
  });

  // ── Menu open / close ─────────────────────────────────────────────────────
  // Tailwind's -translate-x-full slides the panel off screen to the left.
  // translate-x-0 brings it back into view. The backdrop covers the rest of
  // the screen so clicking outside the menu closes it.
  menuBtn.addEventListener('click', () => {
    const isOpen = !sideMenu.classList.contains('-translate-x-full');
    sideMenu.classList.toggle('-translate-x-full', isOpen);   // hide if open
    sideMenu.classList.toggle('translate-x-0', !isOpen);      // show if closed
    backdrop.classList.toggle('hidden', isOpen);
  });

  // Clicking outside the menu (on the backdrop) closes it
  backdrop.addEventListener('click', () => {
    sideMenu.classList.add('-translate-x-full');
    sideMenu.classList.remove('translate-x-0');
    backdrop.classList.add('hidden');
  });
}
