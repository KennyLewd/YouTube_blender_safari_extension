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


  const DESKTOP_RANGES = ['brightness', 'spread', 'verticalSpread', 'blur2', 'framerateLimit', 'frameBlendingSmoothness'];
  const DESKTOP_TOGGLES = ['frameBlending', 'videoOverlayEnabled', 'energySaver'];
  const desktopDisplay = (name, value) => name === 'framerateLimit' ? (value ? `${value} fps` : 'Max') : `${value}%`;
  // The glow's "no limit" is 0. Show it at the right end of the slider (61)
  // so the slider reads slow → fast.
  const FPS_MAX_POSITION = 61;
  const toSlider = (name, value) => name === 'framerateLimit' && value === 0 ? FPS_MAX_POSITION : value;
  const fromSlider = (name, value) => name === 'framerateLimit' && value >= FPS_MAX_POSITION ? 0 : value;

  (async () => {
    const enabledInput = document.getElementById('enabled');
    const status = document.getElementById('status');
    document.getElementById('version').textContent = `Safari extension · v${chrome.runtime.getManifest().version}`;
    let edgeBlend = 20;
    let edgeReach = 160;
    const reachInput = document.getElementById('edgeReach');
    const renderReach = () => {
      reachInput.value = edgeReach;
      document.getElementById('edgeReach-value').textContent = edgeReach ? `${edgeReach}px` : 'Off';
    };
    const edgeInput = document.getElementById('edgeBlend');
    const renderEdge = () => {
      edgeInput.value = edgeBlend;
      document.getElementById('edgeBlend-value').textContent = edgeBlend ? `${edgeBlend}` : 'Off';
    };
    try {
      const stored = await chrome.storage.local.get(['setting-enabled', 'safari-edge-blend', 'safari-header-glass', 'safari-edge-reach']);
      const savedReach = stored['safari-edge-reach'];
      edgeReach = typeof savedReach === 'number' && Number.isFinite(savedReach) ? Math.min(320, Math.max(0, savedReach)) : 160;
      reachInput.disabled = false;
      renderReach();
      enabledInput.checked = stored['setting-enabled'] !== false;
      enabledInput.disabled = false;
      const savedEdge = stored['safari-edge-blend'];
      edgeBlend = typeof savedEdge === 'number' && Number.isFinite(savedEdge) ? Math.min(60, Math.max(0, savedEdge)) : 20;
      edgeInput.disabled = false;
      renderEdge();
      document.getElementById('headerGlass').checked = stored['safari-header-glass'] !== false;
      document.getElementById('headerGlass').disabled = false;
    } catch {
      status.textContent = 'Settings could not be loaded. Close this panel and try again.';
      return;
    }
    let writes = Promise.resolve();
    const save = value => {
      writes = writes.then(() => chrome.storage.local.set(value)).catch(() => {
        status.textContent = 'Could not save this change. Try again.';
      });
    };
    document.getElementById('headerGlass').addEventListener('change', event => save({ 'safari-header-glass': event.target.checked }));
    edgeInput.addEventListener('input', () => {
      edgeBlend = Number(edgeInput.value);
      renderEdge();
      save({ 'safari-edge-blend': edgeBlend });
    });
    reachInput.addEventListener('input', () => {
      edgeReach = Number(reachInput.value);
      renderReach();
      save({ 'safari-edge-reach': edgeReach });
    });
    enabledInput.addEventListener('change', () => save({ 'setting-enabled': enabledInput.checked }));
    const desktopStatus = document.getElementById('desktop-status');
    // Ask the page through extension storage. Used when Safari delivers a
    // message to the tab but loses the reply.
    const askViaStorage = (message, timeout = 2500) => new Promise(resolve => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const onChange = (changes, area) => {
        const response = area === 'local' ? changes['safari-popup-response']?.newValue : null;
        if (response?.id !== id) return;
        cleanup();
        resolve(response.result);
      };
      const timer = setTimeout(() => { cleanup(); resolve(undefined); }, timeout);
      const cleanup = () => { clearTimeout(timer); chrome.storage.onChanged.removeListener(onChange); };
      chrome.storage.onChanged.addListener(onChange);
      chrome.storage.local.set({ 'safari-popup-request': { id, ...message } }).catch(() => { cleanup(); resolve(undefined); });
    });
    // Try a direct message first (top frame only), then the storage route.
    const askTab = tab => async message => {
      let reply;
      try { reply = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }); }
      catch {
        try { reply = await chrome.tabs.sendMessage(tab.id, message); } catch { reply = undefined; }
      }
      return reply ?? askViaStorage(message);
    };
    // Ask the YouTube tab for its state. Retry briefly: right after a refresh
    // the page may still be starting and not listening yet.
    const connect = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('step 1: no active tab was found.');
      const ask = askTab(tab);
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const context = await ask({ type: 'safari-ambient-context' });
          if (context?.renderer === 'desktop') return { tab, context };
          // No reply to the context check: ask the glow for its settings directly.
          const direct = await ask({ type: 'safari-ambient-desktop', action: 'get' });
          if (direct?.values) return { tab, context: { renderer: 'desktop', version: chrome.runtime.getManifest().version } };
          lastError = new Error(context ? `step 2: unexpected reply ${JSON.stringify(context)}`
            : direct?.error ? `step 3: ${direct.error}` : 'step 2: the page sent no reply.');
        } catch (error) {
          lastError = new Error(`step 2: ${error?.message || error}`);
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600));
      }
      throw lastError;
    };
    try {
      const { tab, context } = await connect();
      {
        let requests = Promise.resolve();
        const send = message => {
          requests = requests.then(async () => {
            const result = await askTab(tab)({ type: 'safari-ambient-desktop', ...message })
              .catch(() => askViaStorage({ type: 'safari-ambient-desktop', ...message }));
            if (!result || result.error) throw new Error(result?.error || 'Refresh this YouTube page, then reopen this panel.');
            for (const [name, value] of Object.entries(result.values)) {
              const input = document.getElementById(`desktop-${name}`);
              if (!input) continue;
              if (DESKTOP_TOGGLES.includes(name)) { input.checked = !!value; continue; }
              Object.assign(input, name === 'framerateLimit'
                ? { min: 5, max: FPS_MAX_POSITION, step: 1 } : result.ranges[name]);
              input.value = toSlider(name, value);
              document.getElementById(`desktop-${name}-value`).textContent = desktopDisplay(name, value);
            }
            // Upstream ignores frame blending with "Display framerate" sync.
            document.getElementById('desktop-frameBlending-row').hidden = result.values.frameSync === 1;
            document.getElementById('desktop-frameBlendingSmoothness-row').hidden =
              !result.values.frameBlending || result.values.frameSync === 1;
            document.getElementById('desktop-controls').disabled = false;
            desktopStatus.textContent = message.action === 'balanced' ? 'Balanced glow applied. Changes saved.' : message.action === 'motion' ? 'Video motion matched. Changes saved.' : 'Changes apply immediately and are saved.';
          }).catch(error => { desktopStatus.textContent = error.message || 'Refresh YouTube and reopen this panel.'; });
          return requests;
        };
        for (const name of DESKTOP_RANGES) {
          document.getElementById(`desktop-${name}`).addEventListener('change', event => send({ action: 'set', name, value: fromSlider(name, Number(event.target.value)) }));
          document.getElementById(`desktop-${name}`).addEventListener('input', event => {
            document.getElementById(`desktop-${name}-value`).textContent = desktopDisplay(name, fromSlider(name, Number(event.target.value)));
          });
        }
        for (const name of DESKTOP_TOGGLES) {
          document.getElementById(`desktop-${name}`).addEventListener('change', event => send({ action: 'set', name, value: event.target.checked }));
        }
        document.getElementById('desktop-balanced').addEventListener('click', () => send({ action: 'balanced' }));
        document.getElementById('desktop-motion').addEventListener('click', () => send({ action: 'motion' }));
        await send({ action: 'get' });
      }
      status.textContent = context.error || 'Adjust your glow below.';
      if (context.version !== chrome.runtime.getManifest().version) status.textContent = 'Extension updated. Refresh YouTube to connect the new controls.';
    } catch (error) {
      status.textContent = 'Could not connect to this tab. Open a YouTube video, refresh it (⌘R), wait for it to play, then reopen this panel.';
      // Shown so a failed connection can be diagnosed from a screenshot.
      desktopStatus.textContent = `Not connected. Details: ${error?.message || error}`;
    }
  })();

})();
