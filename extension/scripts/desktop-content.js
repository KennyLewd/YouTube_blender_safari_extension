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


  const getVersion = () => {
    try {
      return (chrome.runtime.getManifest() || {}).version;
    } catch {
      return null;
    }
  };

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

  const eventListenerCallbacks = [];
  function on(elem, eventNames, callback, options, reportOnce = false) {
    try {
      const stack = new Error().stack;
      const callbacksName = `on_${eventNames.split(' ').join('_')}`;
      let reported = [];
      const namedCallbacks = {
        [callbacksName]: async (...args) => {
          try {
            await callback(...args);
          } catch (ex) {
            if (reportOnce) {
              if (reported.includes(ex.message)) return;
              reported.push(ex.message);
            }

            const e = args.length ? args[0] : {};
            const type =
              e.type === 'keydown' ? `${e.type} keyCode: ${e.keyCode}` : e.type;
            ex.message = `${ex.message} \nOn event: ${type}`;

            try {
              if (elem) {
                ex.message = `${ex.message} \nElem: ${elem.toString()} ${
                elem.nodeName || ''
              }#${elem.id || ''}.${elem.className || ''}`;
              }
            } catch (elemEx) {
              ex.details = {
                ...(ex.details || {}),
                elemEx,
              };
            }

            try {
              if (e?.target) {
                ex.message = `${ex.message} \nTarget: ${e.target.toString()} ${
                e.target.nodeName || ''
              }#${e.target.id || ''}.${e.target.className || ''}`;
              }
            } catch (targetEx) {
              ex.details = {
                ...(ex.details || {}),
                targetEx,
              };
            }

            try {
              if (e?.currentTarget) {
                ex.message = `${
                ex.message
              } \nCurrentTarget: ${e.currentTarget.toString()} ${
                e.currentTarget.nodeName || ''
              }#${e.currentTarget.id || ''}.${e.currentTarget.className || ''}`;
              }
            } catch (currentTargetEx) {
              ex.details = {
                ...(ex.details || {}),
                currentTargetEx,
              };
            }

            ex.details = {
              ...(ex.details || {}),
              eventNames,
              options,
              reportOnce,
            };

            appendErrorStack(stack, ex);
            if (errorHandler) errorHandler(ex);
          }
        },
      };
      const eventListenerCallback = namedCallbacks[callbacksName];
      const eventNamesList = eventNames.split(' ');

      const existingEventListenerCallback = eventListenerCallbacks.find(
        (e) =>
          e.args.elem === elem &&
          e.args.callback === callback &&
          JSON.stringify(e.args.options) === JSON.stringify(options)
      );

      for (const eventName of eventNamesList) {
        if (existingEventListenerCallback) {
          if (
            existingEventListenerCallback.args.eventNamesList.includes(eventName)
          ) {
            continue;
          } else {
            existingEventListenerCallback.args.eventNamesList.push(eventName);
          }
        }
        elem.addEventListener(eventName, eventListenerCallback, options);
      }

      if (!existingEventListenerCallback) {
        eventListenerCallbacks.push({
          args: {
            elem,
            eventNamesList,
            callback,
            options,
          },
          callback: eventListenerCallback,
        });
      }
    } catch (ex) {
      ex.details = {
        eventNames,
        options,
        reportOnce,
      };

      try {
        if (elem) {
          ex.message = `${ex.message} \nFor element: ${elem.toString()} ${
          elem.nodeName || ''
        }#${elem.id || ''}.${elem.className || ''}`;
        }
      } catch (elemEx) {
        ex.details = {
          ...(ex.details || {}),
          elemEx,
        };
      }

      console.log('catched', ex);
      throw ex;
    }
  }

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

  let warningElem;
  let warningElemText;
  const setWarning = (text) => {
    if (!warningElem) {
      const elem = document.createElement('div');
      elem.style.position = 'fixed';
      elem.style.zIndex = 999999;
      elem.style.left = 0;
      elem.style.bottom = 0;
      elem.style.padding = '5px 8px';
      elem.style.background = 'rgba(0,0,0,.99)';
      elem.style.color = '#fff';
      elem.style.border = '1px solid #f80';
      elem.style.borderTopRightRadius = '3px';
      elem.style.whiteSpace = 'pre-wrap';
      elem.style.fontSize = '15px';
      elem.style.lineHeight = '18px';
      elem.style.fontFamily = 'sans-serif';
      elem.style.overflowWrap = 'anywhere';
      elem.style.overflow = 'hidden';
      warningElem = elem;

      const closeButton = document.createElement('button');
      closeButton.style.position = 'absolute';
      closeButton.style.zIndex = 2;
      closeButton.style.right = 0;
      closeButton.style.top = 0;
      closeButton.style.border = 'none';
      closeButton.style.borderBottomLeftRadius = '3px';
      closeButton.style.padding = '0px 8px';
      closeButton.style.background = '#f80';
      closeButton.style.fontWeight = 'bold';
      closeButton.style.fontFamily = 'inherit';
      closeButton.style.lineHeight = '20px';
      closeButton.style.fontSize = '22px';
      closeButton.style.color = '#000';
      closeButton.style.cursor = 'pointer';
      closeButton.textContent = 'x';
      on(closeButton, 'click', () => setWarning(''));
      elem.appendChild(closeButton);

      const titleElem = document.createElement('div');
      titleElem.style.fontWeight = 'bold';
      titleElem.style.color = '#008cff';
      titleElem.style.fontSize = '22px';
      titleElem.style.lineHeight = '28px';
      titleElem.textContent = 'Ambient light for YouTube™\n';
      elem.appendChild(titleElem);

      const textElem = document.createElement('div');
      warningElemText = textElem;
      elem.appendChild(textElem);
    }

    const elem = warningElem;
    if (text) {
      warningElemText.textContent = text;
      document.documentElement.appendChild(elem);
    } else {
      warningElemText.textContent = '';
      elem.remove();
    }
  };

  class Storage {
    async set(
      nameOrNamesAndValues,
      value = undefined,
      throwOnUninstalled = false
    ) {
      try {
        const multiple = typeof nameOrNamesAndValues !== 'string';
        const namesAndValues = multiple
          ? nameOrNamesAndValues
          : { [nameOrNamesAndValues]: value };

        const stack = new Error().stack;
        return await new Promise(function storageSet(resolve, reject) {
          try {
            if (!chrome?.runtime?.id) throw new Error('uninstalled');

            const setCallback = () => {
              try {
                if (chrome.runtime.lastError) throw chrome.runtime.lastError;
                resolve();
              } catch (ex) {
                if (!chrome?.runtime?.id) return reject(new Error('uninstalled'));
                appendErrorStack(stack, ex);
                reject(ex);
              }
            };
            if (!multiple && value === undefined) {
              chrome.storage.local.remove([nameOrNamesAndValues], setCallback);
            } else {
              chrome.storage.local.set(namesAndValues, setCallback);
            }
          } catch (ex) {
            if (!chrome?.runtime?.id) return reject(new Error('uninstalled'));
            appendErrorStack(stack, ex);
            reject(ex);
          }
        });
      } catch (ex) {
        if (
          ex &&
          (throwOnUninstalled ||
            !(
              ex.message === 'uninstalled' ||
              ex.message?.includes('QuotaExceededError')
            ))
        )
          throw ex;
      }
    }

    async get(nameOrNames, throwOnUninstalled = false) {
      try {
        const multiple = typeof nameOrNames !== 'string';
        const names = multiple ? nameOrNames : [nameOrNames];
        const stack = new Error().stack;
        return await new Promise(function storageGet(resolve, reject) {
          try {
            if (!chrome?.runtime?.id) throw new Error('uninstalled');

            chrome.storage.local.get(names, function getCallback(result) {
              try {
                if (chrome.runtime.lastError) throw chrome.runtime.lastError;
                resolve(
                  multiple
                    ? result
                    : result[nameOrNames] === undefined
                    ? null
                    : result[nameOrNames]
                );
              } catch (ex) {
                if (!chrome?.runtime?.id) return reject(new Error('uninstalled'));
                appendErrorStack(stack, ex);
                reject(ex);
              }
            });
          } catch (ex) {
            if (!chrome?.runtime?.id) return reject(new Error('uninstalled'));
            appendErrorStack(stack, ex);
            reject(ex);
          }
        });
      } catch (ex) {
        if (
          ex &&
          (throwOnUninstalled ||
            !(
              ex.message === 'uninstalled' ||
              ex.message?.includes('QuotaExceededError')
            ))
        )
          throw ex;
      }
    }

    onChangedListeners = [];

    addListener(handler) {
      try {
        const wrappedHandler = wrapErrorHandler(handler, true);
        chrome.storage.local.onChanged.addListener(wrappedHandler);
        this.onChangedListeners.push({ handler, wrappedHandler });
      } catch (ex) {
        console.warn(
          "Failed to listen to storage changes. If any setting changes you'll have to manually refresh the page to update them."
        );
        console.debug(ex);
      }
    }

    removeListener(handler) {
      try {
        const entry = this.onChangedListeners.find(
          (entry) => entry.handler === handler
        );
        if (!entry)
          throw new Error(
            'Cannot remove a storage.local.onChange listener that has never been added'
          );

        chrome.storage.local.onChanged.removeListener(entry.wrappedHandler);

        this.onChangedListeners.splice(this.onChangedListeners.indexOf(entry), 1);
      } catch {
        console.warn(
          "Failed to listen to storage changes. If any setting changes you'll have to manually refresh the page to update them."
        );
      }
    }
  }

  const storage = new Storage();

  const defaultCrashOptions = {
    video: false,
    technical: false,
    crash: false,
  };

  const setCrashOptions = () => {};
  class SentryReporter {
    static async captureException(error) {
      console.warn('Ambient Light for Safari:', error);
    }
  }

  const origin = 'https://www.youtube.com';
  const extensionId = 'youtube-ambient-light-extension';

  const isSameWindowMessage = (event) =>
    event.source === window && event.origin === origin;

  class InjectedScript {
    globalListener;
    listeners = [];

    addMessageListener = (type, handler) => {
      // console.log('injected addMessageListener', type)
      if (!this.globalListener) {
        // console.log('injected addMessageListenerGlobal')
        this.globalListener = wrapErrorHandler(
          function injectedScriptMessageListenerGlobal(event) {
            if (!event.detail || typeof event.detail !== 'string') return;
            const detail = JSON.parse(event.detail);
            // console.log('received in contentScript', event.detail?.type, event.detail?.injectedScript, event, '|', event.detail?.contentScript);
            if (
              !isSameWindowMessage ||
              detail?.injectedScript !== extensionId ||
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
        function injectedScriptMessageListener(detail) {
          // console.log('injected message?', type, event.detail?.type)
          if (detail.type !== type) return;

          // console.log('injected message!', type)
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
        // console.log('injected removeMessageListener', index, listener)
        this.listeners.splice(index, 1);
      }

      if (this.globalListener && this.listeners.length === 0) {
        // console.log('injected removeMessageListenerGlobal', this.globalListener)
        document.removeEventListener('ytal-message', this.globalListener);
        this.globalListener = undefined;
      }
    };

    postMessage(type, message) {
      const event = new CustomEvent('ytal-message', {
        // bubbles: true,
        detail: JSON.stringify({
          type,
          message,
          contentScript: extensionId,
        }),
      });
      // console.log('dispatched from contentScript', type, extensionId);
      return document.dispatchEvent(event);
    }

    receiveMessage = (type, timeout = 3000) =>
      new Promise(function receiveMessagePromise(resolve, reject) {
        try {
          const receivedMessage = function reveicedMessage(message) {
            clearTimeout(timeoutId);
            injectedScript.removeMessageListener(changedListener);
            resolve(message);
          }.bind(this);

          const receiveMessageTimeout = function receiveMessageTimeout() {
            console.warn(
              `Never received a response message for "${type}" after ${timeout}ms`
            );
            receivedMessage();
          }.bind(this);

          const timeoutId = setTimeout(receiveMessageTimeout, timeout); // Fallback in case messaging fails
          const changedListener = injectedScript.addMessageListener(
            type,
            receivedMessage
          );
        } catch (ex) {
          reject(ex);
        }
      });

    postAndReceiveMessage = async (type, message, timeout) => {
      const receiveMessagePromise = this.receiveMessage(type, timeout);
      this.postMessage(type, message);
      return await receiveMessagePromise;
    };
  }
  const injectedScript = new InjectedScript();

  setErrorHandler((ex) => SentryReporter.captureException(ex));

  injectedScript.addMessageListener('error', (injectedEx) => {
    const ex = new Error(injectedEx.message);
    ex.name = injectedEx.name;
    ex.stack = injectedEx.stack;
    if (injectedEx.details) ex.details = injectedEx.details;

    SentryReporter.captureException(ex);
  });

  const setResourceWarning = (url) => {
    setWarning(
      url
        ? `Failed to load a resource. Reload the webpage to try it again. 
This can happen after you have updated the extension. 

Or if this happens often, view the error in your browser's DevTools javascript console panel. 
Tip: Look for errors about this url: ${url}`
        : `Failed to load the extension on this webpage because it has been updated, reloaded or uninstalled. 
Reload the webpage to reload the extension.`
    );
  };

  const waitForHtmlElement = async () => {
    if (document.documentElement) return;

    const stack = new Error().stack;
    await new Promise((resolve, reject) => {
      try {
        const observer = new MutationObserver(
          wrapErrorHandler(
            function onHtmlElementMutation() {
              if (!document.documentElement) return;

              observer.disconnect();
              resolve();
            }.bind(window),
            true
          )
        );
        observer.observe(document, { childList: true });
      } catch (ex) {
        appendErrorStack(stack, ex);
        reject(ex);
      }
    });
  };

  const waitForHeadElement = async () => {
    if (document.head) return;

    const stack = new Error().stack;
    await new Promise((resolve, reject) => {
      try {
        const observer = new MutationObserver(
          wrapErrorHandler(
            function onHeadElementMutation() {
              if (!document.head) return;

              observer.disconnect();
              resolve();
            }.bind(window),
            true
          )
        );
        observer.observe(document.documentElement, { childList: true });
      } catch (ex) {
        appendErrorStack(stack, ex);
        reject(ex);
      }
    });
  };

  const captureResourceLoadingException = async (url, event) => {
    if (!chrome?.runtime?.id) {
      setResourceWarning();
      return;
    }

    let error;
    try {
      const stack = new Error().stack;
      await new Promise((resolve, reject) => {
        try {
          const req = new XMLHttpRequest();
          req.onreadystatechange = () => {
            try {
              if (req.readyState == XMLHttpRequest.DONE) {
                if (req.status !== 200) {
                  error = new Error(
                    `Cannot load ${url} (Status: ${req.statusText} ${req.status})`
                  );
                  appendErrorStack(stack, error);
                }
                resolve();
              }
            } catch (ex) {
              reject(ex);
            }
          };
          req.open('GET', url, true);
          req.send();
        } catch (ex) {
          appendErrorStack(stack, ex);
          reject(ex);
        }
      });
    } catch (ex) {
      error = ex;
    } finally {
      if (error) {
        error.details = event;
        SentryReporter.captureException(error);
      }

      setResourceWarning(url);
    }
  };

  wrapErrorHandler(async function loadContentScript() {
    getVersion();

    let crashOptions = defaultCrashOptions;
    try {
      crashOptions = (await storage.get('crashOptions')) || defaultCrashOptions;
      setCrashOptions(crashOptions);
    } catch (ex) {
      SentryReporter.captureException(ex);
    }

    storage.addListener(function storageListener(changes) {
      if (!changes.crashOptions?.newValue) return;

      changes.crashOptions.newValue;
    });

    await waitForHtmlElement();
    await waitForHeadElement();

    if (!chrome?.runtime?.id) {
      setResourceWarning();
      return;
    }

    let loaded = await new Promise((resolve) => {
      let url;
      try {
        url = chrome.runtime.getURL('styles/content.css');
      } catch {
        setResourceWarning();
        resolve(false);
        return;
      }

      if (document.head.querySelector(`link[href="${url}"]`)) {
        resolve(true);
        return;
      }

      const style = document.createElement('link');
      style.href = url;
      style.rel = 'stylesheet';
      style.addEventListener(
        'error',
        async function injectStyleOnError(event) {
          await captureResourceLoadingException(style.href, event);
          resolve(false);
        }.bind(this)
      );
      style.addEventListener(
        'load',
        function injectStyleOnLoad() {
          resolve(true);
        }.bind(this)
      );
      document.head.appendChild(style);
    });
    if (!chrome?.runtime?.id) {
      setResourceWarning();
      return;
    }
    if (!loaded) return;

    // The MAIN-world bridge is declared in the manifest. Inserting a script
    // element here is blocked by YouTube’s CSP in Safari.
    const bridgeReady = injectedScript.receiveMessage('safari-bridge-ready');
    injectedScript.postMessage('safari-bridge-ready');
    if ((await bridgeReady) !== true) {
      document.documentElement.dataset.safariAmbientError =
        'The player connection did not start. Reload the extension, then refresh this page.';
      return;
    }

    let scriptUrl;
    try {
      scriptUrl = chrome.runtime.getURL('scripts/content-main.js');
    } catch {
      setResourceWarning();
      return;
    }

    try {
      await import(scriptUrl);
    } catch (error) {
      await captureResourceLoadingException(scriptUrl, error);
    }
  })();

})();
