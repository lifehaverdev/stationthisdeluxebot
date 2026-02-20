/**
 * Lazy loaders for the 4 large vanilla modals.
 *
 * These modals are too large to rewrite in one pass (11K+ LOC combined).
 * Instead, we provide async helpers that dynamically import the old vanilla
 * classes from /sandbox/ and call .show(). This keeps them working while
 * giving us a single import point for future incremental decomposition.
 *
 * Usage:
 *   import { openSpellsMenu } from '../sandbox/components/modals.js';
 *   button.onclick = () => openSpellsMenu();
 */

async function loadVanillaModule(path) {
  const url = '/sandbox/' + path;
  return import(/* @vite-ignore */ url);
}

export async function openSpellsMenu(options = {}) {
  const { default: SpellsMenuModal } = await loadVanillaModule('components/SpellsMenuModal.js');
  const modal = new SpellsMenuModal(options);
  modal.show();
  return modal;
}

export async function openCookMenu(options = {}) {
  const { default: CookMenuModal } = await loadVanillaModule('components/CookMenuModal.js');
  const modal = new CookMenuModal(options);
  modal.show();
  return modal;
}

export async function openModsMenu(options = {}) {
  const { default: ModsMenuModal } = await loadVanillaModule('components/ModsMenuModal.js');
  const modal = new ModsMenuModal(options);
  modal.show();
  return modal;
}

/**
 * BuyPointsModal is an IIFE that sets window.openBuyPointsModal.
 * We load the module (which self-registers) and then call the global.
 */
export async function openBuyPoints() {
  if (!window.openBuyPointsModal) {
    await loadVanillaModule('components/BuyPointsModal/buyPointsModal.js');
  }
  if (window.openBuyPointsModal) {
    window.openBuyPointsModal();
  }
}
