(function () {
  'use strict';

  // eslint-disable-next-line no-unused-vars
  let console;

  (function () {
    const preMessage = 'Ambient light for YouTube™ |';

    const enrich = (...args) => {
      if (args.length <= 0) return args;

      if (typeof args[0] === 'string') {
        const [firstArg, ...postArgs] = args;
        return [`${preMessage} ${firstArg}`, ...postArgs];
      }

      return [preMessage, ...args];
    };

    console = {
      log: (...args) => globalThis.console.log(...enrich(...args)),
      debug: (...args) => globalThis.console.debug(...enrich(...args)),
      warn: (...args) => globalThis.console.warn(...enrich(...args)),
      error: (...args) => globalThis.console.error(...enrich(...args)),
      dir: (...args) => globalThis.console.dir(...args),
    };
  })();


  (async () => {
    if (document.readyState === 'loading') {
      await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    // YouTube may create its application element after DOMContentLoaded.
    if (!document.querySelector('ytd-app') && !location.pathname.startsWith('/embed/')) {
      await new Promise(resolve => {
        const finish = () => { observer.disconnect(); clearTimeout(timeout); resolve(); };
        const observer = new MutationObserver(() => {
          if (document.querySelector('ytd-app')) finish();
        });
        const timeout = setTimeout(finish, 4000);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
    }
    // Mac-only build: www.youtube.com always uses the desktop renderer.
    const renderer = 'desktop';
    // Restore the requested blur preset once when moving away from the AI experiment.
    // Complete before starting the renderer, so it reads consistent saved settings.
    const migration = await chrome.storage.local.get(['safari-blur-restored-111']);
    if (!migration['safari-blur-restored-111']) {
      await chrome.storage.local.set({
        'setting-enabled': true, 'setting-brightness': 80, 'setting-spread': 17,
        'setting-verticalSpread': 150, 'setting-blur2': 45,
        'safari-edge-blend': 28, 'safari-blur-restored-111': true,
      });
      await chrome.storage.local.remove(['safari-generated-enabled', 'safari-generated-token']);
    }
    // Mac-only build: drop settings left behind by the removed mobile renderer.
    const macOnly = await chrome.storage.local.get(['safari-mac-only-120']);
    if (!macOnly['safari-mac-only-120']) {
      await chrome.storage.local.remove(['safari-mobile']);
      await chrome.storage.local.set({ 'safari-mac-only-120': true });
    }
    const version = chrome.runtime.getManifest().version;
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message?.type !== 'safari-ambient-context') return undefined;
      const context = { renderer, version, error: document.documentElement.dataset.safariAmbientError || null };
      reply(context);
      // Safari can drop a synchronous reply; returning a promise delivers it there.
      return Promise.resolve(context);
    });
    // Storage fallback for the same question (see content-main.js).
    chrome.storage.onChanged.addListener((changes, area) => {
      const request = area === 'local' ? changes['safari-popup-request']?.newValue : null;
      if (request?.type !== 'safari-ambient-context' || !request.id || document.visibilityState !== 'visible') return;
      chrome.storage.local.set({ 'safari-popup-response': { id: request.id, result: {
        renderer, version, error: document.documentElement.dataset.safariAmbientError || null } } });
    });
    try {
      await import(chrome.runtime.getURL('scripts/header-glass.js'));
      await import(chrome.runtime.getURL('scripts/desktop-content.js'));
      await import(chrome.runtime.getURL('scripts/edge-blend.js'));
    } catch (error) {
      console.error('Ambient Light for Safari could not start:', error);
      document.documentElement.dataset.safariAmbientError = 'Reload this YouTube page to restart ambient light.';
    }
  })();

})();
