// ── Entry point ───────────────────────────────────────────────────────────────
// Loaded as <script type="module"> from index.html.
// Imports the four initialisation functions and runs them in order.

import { render }                   from './js/score.js';
import { initKeyboard, initKeypad } from './js/input.js';
import { initMenu }                 from './js/menu.js';
import { initImport } from './js/import-ui.js';

// Register keyboard shortcuts and the floating keypad click handlers
initKeyboard();
initKeypad();

// Set up the side-menu (bars-per-line control)
initMenu();
initImport();

// Draw the initial empty score
render();
