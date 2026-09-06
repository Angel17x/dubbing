// DubAI — inyector del hook de red (content script a document_start, mundo aislado → página)
(function () {
  'use strict';
  try {
    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/content/net-hook.js');
    s.async = false;
    s.onload = function () {
      s.remove();
    };
    (document.documentElement || document.head || document).appendChild(s);
  } catch (e) {
    /* silencioso */
  }
})();
