// ── Entry point ───────────────────────────────────────────────────────────────
// Loaded as <script type="module"> from index.html.
// Imports the four initialisation functions and runs them in order.

import { render }                   from './js/score.js';
import { initKeyboard, initKeypad } from './js/input.js';
import { initMenu }                 from './js/menu.js';
import { initImport } from './js/import-ui.js';
import { initDetails } from './js/details-ui.js';
import { initFiles } from './js/file-ui.js';

// Register keyboard shortcuts and the floating keypad click handlers
initKeyboard();
initKeypad();

// Set up the side-menu (bars-per-line control)
initMenu();
initImport();

initDetails();

// Draw the initial empty score, then offer to restore anything unsaved from a crash
render();
initFiles();
