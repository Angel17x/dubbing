// DubAI — hook de red en contexto de página: captura URLs de subtítulos (.vtt) pedidas por el player
(function () {
  'use strict';
  if (window.__DUBAI_NET_HOOK__) return;
  window.__DUBAI_NET_HOOK__ = true;

  var found = {};

  function add(u) {
    try {
      u = String(u);
      if (/\.vtt(\?|&|$)/i.test(u) || /caption|subtitle/i.test(u)) {
        if (/^https?:\/\//i.test(u)) found[u] = 1;
      }
    } catch (e) {}
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      try {
        var a0 = arguments[0];
        add(a0 && a0.url ? a0.url : a0);
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      add(url);
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  window.addEventListener('message', function (ev) {
    if (ev.source === window && ev.data && ev.data.source === 'DUBAI_CONTENT' && ev.data.type === 'REQUEST_VTT_URLS') {
      window.postMessage({ source: 'DUBAI_HOOK', type: 'VTT_URLS', urls: Object.keys(found) }, '*');
    }
  });
})();
