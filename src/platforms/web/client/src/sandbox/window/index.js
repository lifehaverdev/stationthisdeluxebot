// Factory exports for sandbox windows
import UploadWindow from './UploadWindow.js';

export function createUploadWindow(opts) {
  const win = new UploadWindow(opts);
  win.mount();
  return win;
}

// Future: export other window factories here
