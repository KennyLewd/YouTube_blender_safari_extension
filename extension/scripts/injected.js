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


  let errorHandler = (ex) => {
    console.error(ex);
  };
  const setErrorHandler = (handler) => {
    errorHandler = handler;
  };

  const wrapErrorHandlerHandleError = (stack, ex, reportOnce, reported) => {
    if (reportOnce) {
      if (reported.includes(ex.message)) return;
      reported.push(ex.message);
    }
    appendErrorStack(stack, ex);
    if (errorHandler) errorHandler(ex);
  };

  const withErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || 'anonymous';
    const container = {
      [callbackName]: (...args) => {
        try {
          return callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      },
    };
    return container[callbackName];
  };

  const withAsyncErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || 'anonymous';
    const container = {
      [callbackName]: async (...args) => {
        try {
          return await callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      },
    };
    return container[callbackName];
  };

  const wrapErrorHandler = (callback, reportOnce = false) =>
    (callback.constructor.name === 'AsyncFunction'
      ? withAsyncErrorHandler
      : withErrorHandler)(callback, reportOnce, new Error().stack, []);

  // rec2020 in canvas is not yet supported
    // globalThis.matchMedia('(color-gamut: rec2020)').matches
    //   ? 'rec2020'
    //   : (
    globalThis.matchMedia('(color-gamut: p3)').matches ? 'display-p3' : 'srgb';
  //  )

  // rec2020 in canvas is not yet supported
    globalThis.matchMedia('(color-gamut: rec2020)').matches
      ? 'rec2020'
      : globalThis.matchMedia('(color-gamut: p3)').matches
      ? 'display-p3'
      : 'srgb';

  const appendErrorStack = (stack, ex) => {
    try {
      const stackToAppend = stack?.substring(stack?.indexOf('\n') + 1);
      const stackToSearch = stackToAppend?.substring(
        stackToAppend?.indexOf('\n') + 1
      ); // The first line in the stack trace can contain an extra function name
      const alreadyContainsStack =
        (ex?.stack || ex?.message || ex?.toString())?.indexOf(stackToSearch) !==
        -1;
      if (!alreadyContainsStack) {
        ex.stack = `${ex.stack || ex.message || ex.toString()}\n${stackToAppend}`;
      }
    } catch (ex) {
      console.warn(ex);
    }
  };

  const setStyleProperty = (elem, name, value, priority = '') => {
    const currentValue = elem.style.getPropertyValue(name) ?? '';
    const currentPriority = elem.style.getPropertyPriority(name) ?? '';
    if (currentValue === value && currentPriority === priority) return; // Prevent MutationObservers from firing

    elem.style.setProperty(name, value, priority);
  };

  const origin = 'https://www.youtube.com';
  const extensionId = 'youtube-ambient-light-extension';

  const isSameWindowMessage = (event) =>
    event.source === window && event.origin === origin;

  class ContentScript {
    globalListener;
    listeners = [];

    addMessageListener = (type, handler) => {
      // console.log('content addMessageListener', type)
      if (!this.globalListener) {
        // console.log('content addMessageListenerGlobal')
        this.globalListener = wrapErrorHandler(
          function contentScriptMessageListenerGlobal(event) {
            if (!event.detail || typeof event.detail !== 'string') return;
            const detail = JSON.parse(event.detail);
            // console.log('received in injectedScript', event.detail?.type, event.detail?.contentScript, event, '|', event.detail?.injectedScript);
            if (
              !isSameWindowMessage ||
              detail?.contentScript !== extensionId ||
              !detail?.type
            )
              return;

            for (const listener of this.listeners) {
              listener(detail);
            }
          }.bind(this),
          true
        );
        document.addEventListener('ytal-message', this.globalListener);
      }

      const listener = wrapErrorHandler(
        function contentScriptMessageListener(detail) {
          // console.log('content message?', type, event.detail?.type)
          if (detail.type !== type) return;

          // console.log('content message!', type)
          handler(detail?.message);
        }.bind(this),
        true
      );

      this.listeners.push(listener);
      return listener;
    };

    removeMessageListener = (listener) => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        // console.log('content removeMessageListener', index, listener)
        this.listeners.splice(index, 1);
      }

      if (this.globalListener && this.listeners.length === 0) {
        // console.log('content removeMessageListenerGlobal', this.globalListener)
        document.removeEventListener('ytal-message', this.globalListener, true);
        this.globalListener = undefined;
      }
    };

    postMessage = (type, message) => {
      const event = new CustomEvent('ytal-message', {
        detail: JSON.stringify({
          type,
          message,
          injectedScript: extensionId,
        }),
      });
      // console.log('dispatched from injectedScript', type, extensionId);
      return document.dispatchEvent(event);
    };
  }
  const contentScript = new ContentScript();

  let reporting = false; // Prevent infinite loops
  setErrorHandler((ex) => {
    if (reporting) return;

    try {
      reporting = true;
      contentScript.postMessage('error', {
        name: ex.name,
        message: ex.message,
        stack: ex.stack,
        details: ex.details,
      });
    } catch (reportEx) {
      console.warn('Failed to report error:', ex, 'innerError:', reportEx);
    } finally {
      reporting = false;
    }
  });

  const getElem = (() => {
    const elems = {};
    return (name) => {
      if (!elems[name]?.isConnected) {
        if (elems[name] && !elems[name].isConnected) {
          elems[name].dataset.ytalElem = name;
        }
        elems[name] = document.querySelector(`[data-ytal-elem="${name}"]`);
        if (elems[name]) {
          delete elems[name].dataset.ytalElem;
        }
      }
      return elems[name];
    };
  })();

  function updateTheme(toDark) {
    document.documentElement.toggleAttribute('dark', toDark);

    const ytdAppElem = getElem('ytd-app');
    if (ytdAppElem?.setMastheadTheme) {
      ytdAppElem.setMastheadTheme();
    }
  }

  contentScript.addMessageListener(
    'update-theme',
    function onUpdateTheme(toDark) {
      updateTheme(toDark);
      contentScript.postMessage('update-theme');
    }
  );

  const updateImmersiveMode = function updateImmersiveMode(
    enable,
    skipVideoPlayerSetSize = false
  ) {
    const html = document.documentElement;
    const enabled = html.getAttribute('data-ambientlight-immersive') != null;
    if (enabled === enable) return;

    const scroll = {
      x: window.scrollX,
      y: window.scrollY,
    };

    html.toggleAttribute('data-ambientlight-immersive', enable);
    const shift = enable ? 29 : -29;
    if (scroll.y > 50 && scroll.y < 100) {
      window.scrollTo(scroll.x, (scroll.y += shift));
    }

    const ytdApp = getElem('ytd-app');
    if (ytdApp?.mastheadHeight) {
      ytdApp.mastheadHeight += shift;
      ytdApp.updateMastheadCssHeight?.();
    }

    if (!skipVideoPlayerSetSize && enabled !== enable) videoPlayerSetSize();
  };

  contentScript.addMessageListener(
    'update-immersive-mode',
    function onUpdateImmersiveMode(enable) {
      updateImmersiveMode(enable);
      contentScript.postMessage('update-immersive-mode');
    }
  );

  contentScript.addMessageListener(
    'set-live-chat-theme',
    function seLiveChatTheme(toDark) {
      const liveChatElem = getElem('live-chat');
      if (!liveChatElem) return;

      liveChatElem.postToContentWindow({
        'yt-live-chat-set-dark-theme': toDark,
      });
    }
  );

  contentScript.addMessageListener('is-hdr-video', function isHdrVideo() {
    const videoPlayerElem = getElem('video-player');
    const isHdr = videoPlayerElem?.getVideoData?.()?.isHdr ?? false;
    contentScript.postMessage('is-hdr-video', isHdr);
  });

  contentScript.addMessageListener(
    'player-storyboard-format',
    function playerStoryboardSpec() {
      const player = getElem('video-player');
      const format = player?.getStoryboardFormat?.();
      contentScript.postMessage('player-storyboard-format', format);
    }
  );

  function videoPlayerSetSize() {
    const videoPlayerElem = getElem('video-player');
    if (videoPlayerElem) {
      try {
        videoPlayerElem.setSize();
        videoPlayerElem.setInternalSize();
      } catch (ex) {
        console.warn(
          `Failed to resize the video player${
          ex?.message ? `: ${ex?.message}` : ''
        }`
        );
      }
    }
    contentScript.postMessage('sizes-changed');
  }

  contentScript.addMessageListener(
    'video-player-set-size',
    function onVideoPlayerSetSize() {
      videoPlayerSetSize();
      contentScript.postMessage('video-player-set-size');
    }
  );

  let vrVideoCtx;
  let vrVideoCtxDrawArrays;
  const drawVR = (...args) => {
    const result = vrVideoCtxDrawArrays.bind(vrVideoCtx)(...args);
    contentScript.postMessage('next-vr-frame');
    return result;
  };

  contentScript.addMessageListener('init-vr-video', function initVrVideo() {
    const vrVideoElem = getElem('vr-video');
    vrVideoCtx = vrVideoElem.getContext('webgl');
    if (vrVideoCtx) {
      if (vrVideoCtx.drawArrays !== drawVR) {
        vrVideoCtxDrawArrays = vrVideoCtx.drawArrays;
        vrVideoCtx.drawArrays = drawVR;
      }
    }
  });

  contentScript.addMessageListener('dispose-vr-video', function disposeVrVideo() {
    if (!vrVideoCtx) return;

    vrVideoCtx.drawArrays = vrVideoCtxDrawArrays;
    vrVideoCtx = undefined;
  });

  contentScript.addMessageListener(
    'show',
    function show({
      ytdAppElemBackground,
      toDark,
      hideScrollbar,
      relatedScrollbar,
      immersiveMode,
    }) {
      const mastheadElem = getElem('masthead');
      if (mastheadElem) mastheadElem.classList.add('no-animation');

      const ytdAppElem = getElem('ytd-app');
      // const playerTheaterContainerElem = getElem(
      //   watchSelectors
      //     .map((selector) => `${selector} #full-bleed-container`)
      //     .join(', ')
      // );

      // Temporary backgrounds
      // if (playerTheaterContainerElem) {
      //   setStyleProperty(
      //     playerTheaterContainerElem,
      //     'background',
      //     'none',
      //     'important'
      //   );
      // }
      if (ytdAppElem)
        setStyleProperty(
          ytdAppElem,
          'background',
          ytdAppElemBackground,
          'important'
        );

      const html = document.documentElement;
      if (hideScrollbar)
        html.toggleAttribute('data-ambientlight-hide-scrollbar', true);
      if (relatedScrollbar)
        html.toggleAttribute('data-ambientlight-related-scrollbar', true);
      if (immersiveMode) updateImmersiveMode(true, true);

      updateTheme(toDark);

      // await new Promise((resolve) => raf(resolve));
      // // eslint-disable-next-line no-unused-vars
      // const _1 = videoElem.clientWidth;
      html.toggleAttribute('data-ambientlight-enabled', true);

      videoPlayerSetSize();

      // Restore default backgrounds
      // if (playerTheaterContainerElem)
      //   playerTheaterContainerElem.style.background = '';
      if (ytdAppElem) ytdAppElem.style.background = '';

      if (mastheadElem) mastheadElem.classList.remove('no-animation');
      contentScript.postMessage('show');
    }
  );

  contentScript.addMessageListener('hide', function hide({ toDark }) {
    const mastheadElem = getElem('masthead');
    if (mastheadElem) mastheadElem.classList.add('no-animation');

    const html = document.documentElement;
    html.toggleAttribute('data-ambientlight-enabled', false);

    html.toggleAttribute('data-ambientlight-hide-scrollbar', false);
    html.toggleAttribute('data-ambientlight-related-scrollbar', false);

    updateImmersiveMode(false, true);

    updateTheme(toDark);

    videoPlayerSetSize();

    if (mastheadElem) mastheadElem.classList.remove('no-animation');
    contentScript.postMessage('hide');
  });

  contentScript.addMessageListener(
    'video-player-update-video-data-keywords',
    function videoPlayerUpdateVideoDataKeywords(keywords) {
      const videoPlayerElem = getElem('video-player');
      if (!videoPlayerElem) return;

      videoPlayerElem.updateVideoData({ keywords });
    }
  );

  contentScript.addMessageListener(
    'video-player-reload-video-by-id',
    function videoPlayerReloadVideoById() {
      const videoPlayerElem = getElem('video-player');
      if (videoPlayerElem) {
        const id = videoPlayerElem.getVideoData()?.video_id;
        if (id) videoPlayerElem.loadVideoById(id); // Refreshes auto quality setting range above 480p
      }
      contentScript.postMessage('video-player-reload-video-by-id');
    }
  );

  let videoObserver;
  let videoObserverElem;
  contentScript.addMessageListener(
    'apply-chromium-bug-1142112-workaround',
    function applyChromiumBug1142112Workaround() {
      try {
        const videoElem = getElem('video');
        if (videoObserverElem === videoElem) return;

        if (videoObserver) {
          videoObserver.disconnect();
          videoObserver = undefined;
        }
        videoObserverElem = videoElem;
        if (!videoElem || videoElem.ambientlightGetVideoPlaybackQuality) return;

        let videoIsHidden = false; // IntersectionObserver is always executed at least once when the observation starts
        let videoVisibilityChangeTime;
        videoObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (videoObserverElem !== entry.target) continue;
              videoIsHidden = entry.intersectionRatio === 0;
              videoVisibilityChangeTime = performance.now();
            }
          },
          {
            rootMargin: '-70px 0px 0px 0px', // masthead height (56px) + additional pixel to be safe
            threshold: 0.0001, // Because sometimes a pixel in not visible on screen but the intersectionRatio is already 0
          }
        );
        videoObserver.observe(videoElem);

        Object.defineProperty(videoElem, 'ambientlightGetVideoPlaybackQuality', {
          value: videoElem.getVideoPlaybackQuality,
        });

        let previousDroppedVideoFrames = 0;
        let droppedVideoFramesCorrection = 0;
        let previousTime = performance.now();

        videoElem.getVideoPlaybackQuality = function () {
          // Use scoped properties instead of this from here on
          const original = videoElem.ambientlightGetVideoPlaybackQuality();
          let droppedVideoFrames = original.droppedVideoFrames;
          if (droppedVideoFrames < previousDroppedVideoFrames) {
            previousDroppedVideoFrames = 0;
            droppedVideoFramesCorrection = 0;
          }
          // Ignore dropped frames for 2 seconds due to requestVideoFrameCallback dropping frames when the video is offscreen
          if (videoIsHidden || videoVisibilityChangeTime > previousTime - 2000) {
            droppedVideoFramesCorrection +=
              droppedVideoFrames - previousDroppedVideoFrames;
          }
          previousDroppedVideoFrames = droppedVideoFrames;
          droppedVideoFrames = Math.max(
            0,
            droppedVideoFrames - droppedVideoFramesCorrection
          );
          previousTime = performance.now();
          return {
            corruptedVideoFrames: original.corruptedVideoFrames,
            creationTime: original.creationTime,
            droppedVideoFrames,
            totalVideoFrames: original.totalVideoFrames,
          };
        };
      } catch (ex) {
        console.warn(
          'Failed to apply getVideoPlaybackQuality workaround. Continuing ambientlight initialization...'
        );
        throw ex;
      }
    }.bind(window)
  );

  // Confirm that Safari has installed this bridge in the page’s MAIN world.
  contentScript.addMessageListener('safari-bridge-ready', () => {
    contentScript.postMessage('safari-bridge-ready', true);
  });

})();
