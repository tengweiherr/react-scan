(function () {
  window.__layoutDebugLog = {
    calls: [],
  };

  const LOG_EVERY_CALL = false;

  function recordCall(apiName) {
    const now = performance.now();
    const stack = new Error().stack
      .split('\n')
      .slice(2)
      .map((line) => line.trim())
      .join('\n');

    const entry = { api: apiName, time: now, stack };
    window.__layoutDebugLog.calls.push(entry);

    if (LOG_EVERY_CALL) {
      console.warn(
        `[LayoutDebug] ${apiName} at ${now.toFixed(2)}ms\nStack:\n${stack}`,
      );
    }
  }

  function patchFunction(obj, funcName) {
    const original = obj[funcName];
    if (typeof original !== 'function') return;

    Object.defineProperty(obj, funcName, {
      value: function patchedFunction(...args) {
        recordCall(`${funcName}()`);
        return original.apply(this, args);
      },
      writable: true,
      configurable: true,
    });
  }

  function patchGetter(obj, propName) {
    const desc = Object.getOwnPropertyDescriptor(obj, propName);
    if (!desc) return;
    const originalGet = desc.get;
    if (typeof originalGet !== 'function') return;

    const newDesc = {
      ...desc,
      get: function patchedGetter() {
        recordCall(propName);
        return originalGet.call(this);
      },
    };
    Object.defineProperty(obj, propName, newDesc);
  }

  patchFunction(Element.prototype, 'getBoundingClientRect');

  patchGetter(Element.prototype, 'offsetWidth');
  patchGetter(Element.prototype, 'offsetHeight');
  patchGetter(Element.prototype, 'clientWidth');
  patchGetter(Element.prototype, 'clientHeight');
  patchGetter(Element.prototype, 'scrollWidth');
  patchGetter(Element.prototype, 'scrollHeight');

  (function patchGetComputedStyle() {
    const original = window.getComputedStyle;
    if (typeof original === 'function') {
      window.getComputedStyle = function (...args) {
        recordCall('getComputedStyle()');
        return original.apply(this, args);
      };
    }
  })();

  console.log(
    '%c[LayoutDebug] Patched layout APIs. Interact and then inspect window.__layoutDebugLog.calls',
    'color: green;',
  );
})();
