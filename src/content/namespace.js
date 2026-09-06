// DubAI — namespace compartido entre los content scripts (scripts clásicos, sin módulos)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  D.log = (...a) => console.log('[DubAI]', ...a);
  D.warn = (...a) => console.warn('[DubAI]', ...a);
  D.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  D.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  D.LANGS = [
    { code: 'es', name: 'Español' },
    { code: 'en', name: 'Inglés' },
    { code: 'fr', name: 'Francés' },
    { code: 'de', name: 'Alemán' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Portugués' },
    { code: 'ru', name: 'Ruso' },
    { code: 'zh', name: 'Chino (simplificado)' },
    { code: 'ja', name: 'Japonés' },
    { code: 'ko', name: 'Coreano' },
    { code: 'ar', name: 'Árabe' },
    { code: 'hi', name: 'Hindi' },
    { code: 'nl', name: 'Neerlandés' },
    { code: 'pl', name: 'Polaco' },
    { code: 'tr', name: 'Turco' },
    { code: 'vi', name: 'Vietnamita' },
    { code: 'id', name: 'Indonesio' },
    { code: 'th', name: 'Tailandés' },
    { code: 'uk', name: 'Ucraniano' },
    { code: 'sv', name: 'Sueco' }
  ];

  D.DEFAULT_SETTINGS = {
    enabled: false,
    targetLang: 'es',
    sourceLang: 'auto',
    voiceURI: '',
    voiceBackend: 'xtts',
    xttsUrl: 'http://127.0.0.1:8020',
    xttsReference: 'C:\\Users\\PC\\Downloads\\ElevenLabs_2026-09-06T02_00_43_Roger - Laid-Back, Casual, Resonant_pre_sp100_s50_sb75_se0_b_m2.mp3',
    rate: 1.0,
    duck: true,
    duckLevel: 0.25,
    showSubs: true,
    whisperFallback: false,
    translatorBackend: 'auto', // 'auto' | 'chrome' | 'offscreen' | 'ollama'
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1:8b'
  };

  D.getSettings = () =>
    new Promise((res) => chrome.storage.sync.get(D.DEFAULT_SETTINGS, (s) => res(Object.assign({}, D.DEFAULT_SETTINGS, s))));

  D.saveSettings = (s) => chrome.storage.sync.set(s);

  D.waitForVideo = (timeout = 20000) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        const v = document.querySelector('video');
        if (v) return resolve(v);
        if (Date.now() - t0 > timeout) return reject(new Error('No se encontró ningún <video> en la página'));
        setTimeout(poll, 400);
      })();
    });

  // Detecta el sitio actual (extractor específico o genérico)
  D.currentSite = () => {
    const h = location.hostname;
    if (h.includes('youtube')) return 'youtube';
    if (h.includes('udemy')) return 'udemy';
    return 'generic';
  };
})(window.DubAI);
