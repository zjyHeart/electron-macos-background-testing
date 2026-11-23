// Preload with `electron -r /path/to/background-electron.cjs <app>`.
// This modifies only the launched Electron process, not the installed app.
if (process.platform === 'darwin') {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const electron = originalLoad.call(Module, 'electron', module, false);

  // Run before the app creates its first window: hiding it later can be too late.
  electron.app.setActivationPolicy('accessory');

  const BackgroundWindow = new Proxy(electron.BrowserWindow, {
    construct(Target, args, newTarget) {
      const options = args[0] || {};
      const preferences = options.webPreferences || {};
      const updated = {
        ...options,
        show: false,
        // Preserve offscreen render settings; keep ordinary hidden windows painting.
        webPreferences: preferences.offscreen ? preferences : { ...preferences, backgroundThrottling: false },
      };
      return Reflect.construct(Target, [updated], newTarget === BackgroundWindow ? Target : newTarget);
    },
  });
  const backgroundElectron = new Proxy(electron, {
    get(target, property, receiver) {
      return property === 'BrowserWindow' ? BackgroundWindow : Reflect.get(target, property, receiver);
    },
  });
  Module._load = function (request, ...args) {
    return request === 'electron' ? backgroundElectron : originalLoad.call(this, request, ...args);
  };
}
