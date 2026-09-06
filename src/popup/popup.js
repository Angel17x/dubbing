// DubAI — popup: configuración y control del doblaje en la pestaña activa
(function () {
  'use strict';

  const LANGS = [
    { code: 'es', name: 'Español' }, { code: 'en', name: 'Inglés' }, { code: 'fr', name: 'Francés' },
    { code: 'de', name: 'Alemán' }, { code: 'it', name: 'Italiano' }, { code: 'pt', name: 'Portugués' },
    { code: 'ru', name: 'Ruso' }, { code: 'zh', name: 'Chino' }, { code: 'ja', name: 'Japonés' },
    { code: 'ko', name: 'Coreano' }, { code: 'ar', name: 'Árabe' }, { code: 'hi', name: 'Hindi' },
    { code: 'nl', name: 'Neerlandés' }, { code: 'pl', name: 'Polaco' }, { code: 'tr', name: 'Turco' },
    { code: 'vi', name: 'Vietnamita' }, { code: 'id', name: 'Indonesio' }, { code: 'th', name: 'Tailandés' },
    { code: 'uk', name: 'Ucraniano' }, { code: 'sv', name: 'Sueco' }
  ];

  const DEFAULTS = {
    targetLang: 'es', sourceLang: 'auto', voiceURI: '', rate: 1.0,
    duck: true, duckLevel: 0.25, showSubs: true, whisperFallback: false, translatorBackend: 'auto',
    ollamaUrl: 'http://localhost:11434', ollamaModel: 'llama3.1:8b',
    ollamaModelUpgradeV1: false,
    voiceBackend: 'xtts', xttsUrl: 'http://127.0.0.1:8020',
    xttsReference: 'C:\\Users\\PC\\Downloads\\ElevenLabs_2026-09-06T02_00_43_Roger - Laid-Back, Casual, Resonant_pre_sp100_s50_sb75_se0_b_m2.mp3'
  };

  const $ = (id) => document.getElementById(id);
  let settings = {};
  let activeTab = null;

  function fillLangs(sel, withAuto) {
    sel.innerHTML = '';
    if (withAuto) sel.append(new Option('Automático', 'auto'));
    for (const l of LANGS) sel.append(new Option(l.name, l.code));
  }

  function fillVoices(lang) {
    const sel = $('voice');
    sel.innerHTML = '';
    sel.append(new Option('Automática', ''));
    const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
    for (const v of voices) sel.append(new Option(`${v.name} (${v.lang})`, v.voiceURI));
    sel.value = settings.voiceURI || '';
  }

  function collect() {
    settings = {
      targetLang: $('targetLang').value,
      sourceLang: $('sourceLang').value,
      voiceURI: $('voice').value,
      voiceBackend: $('voiceBackend').value,
      xttsUrl: $('xttsUrl').value.trim() || 'http://127.0.0.1:8020',
      xttsReference: $('xttsReference').value.trim(),
      rate: parseFloat($('rate').value),
      duck: $('duck').checked,
      duckLevel: parseFloat($('duckLevel').value),
      showSubs: $('showSubs').checked,
      whisperFallback: $('whisperFallback').checked,
      translatorBackend: $('translatorBackend').value,
      ollamaUrl: $('ollamaUrl').value.trim() || 'http://localhost:11434',
      ollamaModel: $('ollamaModel').value.trim() || 'llama3.1:8b'
    };
  }

  function toggleOllamaCfg() {
    $('ollamaCfg').classList.toggle('hidden', $('translatorBackend').value !== 'ollama');
  }

  function toggleVoiceCfg() {
    const xtts = $('voiceBackend').value === 'xtts';
    $('xttsCfg').classList.toggle('hidden', !xtts);
    $('systemVoiceCfg').classList.toggle('hidden', xtts);
  }

  async function testXtts() {
    const st = $('xttsStatus');
    st.textContent = 'Conectando…';
    try {
      const res = await Promise.race([
        chrome.runtime.sendMessage({
          type: 'DUBAI_XTTS_STATUS',
          url: $('xttsUrl').value.trim() || 'http://127.0.0.1:8020'
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('tiempo de espera agotado')), 10000))
      ]);
      if (!res || res.error || !res.ok) throw new Error((res && res.error) || 'sin respuesta');
      st.textContent = res.reference_exists
        ? `✔ XTTS disponible · ${res.gpu || 'CPU'}${res.loaded ? ' · modelo cargado' : ' · cargará al hablar'}`
        : '✖ Conectado, pero no se encontró el audio de referencia.';
    } catch (e) {
      st.textContent = '✖ XTTS no responde. Ejecuta scripts\\start-xtts.ps1 — ' + (e.message || e);
    }
  }

  async function testOllama() {
    const st = $('ollamaStatus');
    const url = ($('ollamaUrl').value.trim() || 'http://localhost:11434').replace(/\/+$/, '');
    st.textContent = 'Conectando…';
    try {
      // La petición va por el service worker (permisos de host → sin CORS)
      const res = await chrome.runtime.sendMessage({ type: 'DUBAI_OLLAMA_TAGS', url });
      if (!res || res.error) throw new Error((res && res.error) || 'sin respuesta');
      const models = res.models || [];
      const dl = $('ollamaModels');
      dl.innerHTML = '';
      for (const m of models) dl.append(new Option(m, m));
      st.textContent = models.length
        ? `✔ Conectado. Modelos: ${models.join(', ')}`
        : '✔ Conectado, pero no hay modelos. Instala uno: ollama pull llama3.1:8b';
    } catch (e) {
      st.textContent = '✖ Sin conexión con Ollama. ¿Está ejecutándose? (ollama serve) — ' + (e.message || e);
    }
  }

  async function apply() {
    collect();
    await chrome.storage.sync.set(settings);
    $('rateVal').textContent = settings.rate.toFixed(2).replace(/0$/, '');
    $('duckVal').textContent = `${Math.round(settings.duckLevel * 100)}%`;
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'DUBAI_SETTINGS', settings }).catch(() => {});
    }
  }

  async function refreshState() {
    const badge = $('state');
    const btn = $('toggle');
    if (!activeTab || !/^https?:/.test(activeTab.url || '')) {
      badge.textContent = 'sin video';
      btn.disabled = true;
      return;
    }
    // Pregunta a la pestaña: responde el frame que tenga el video (aunque sea un embed en iframe)
    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'DUBAI_STATUS' });
      const on = res && ['loading', 'ready', 'whisper'].includes(res.state);
      badge.textContent = on ? 'activo' : 'inactivo';
      badge.classList.toggle('on', !!on);
      btn.textContent = on ? '⏹ Detener doblaje' : '▶ Activar doblaje';
      btn.classList.toggle('stop', !!on);
      btn.disabled = false;
    } catch (e) {
      badge.textContent = 'sin video';
      btn.disabled = true;
      $('hint').textContent =
        'Abre una página con video (YouTube, Udemy, o un curso con video de YouTube incrustado), recárgala y pulsa «Activar doblaje».';
    }
  }

  async function init() {
    settings = await chrome.storage.sync.get(DEFAULTS);
    settings = Object.assign({}, DEFAULTS, settings);
    if (!settings.ollamaModelUpgradeV1 && settings.ollamaModel === 'qwen2.5:3b') {
      settings.ollamaModel = 'llama3.1:8b';
      settings.ollamaModelUpgradeV1 = true;
      await chrome.storage.sync.set({
        ollamaModel: settings.ollamaModel,
        ollamaModelUpgradeV1: true
      });
    }

    fillLangs($('targetLang'), false);
    fillLangs($('sourceLang'), true);
    $('targetLang').value = settings.targetLang;
    $('sourceLang').value = settings.sourceLang;
    $('voiceBackend').value = settings.voiceBackend;
    $('xttsUrl').value = settings.xttsUrl;
    $('xttsReference').value = settings.xttsReference;
    toggleVoiceCfg();
    $('rate').value = settings.rate;
    $('duck').checked = settings.duck;
    $('duckLevel').value = settings.duckLevel;
    $('showSubs').checked = settings.showSubs;
    $('whisperFallback').checked = settings.whisperFallback;
    $('translatorBackend').value = settings.translatorBackend;
    $('ollamaUrl').value = settings.ollamaUrl;
    $('ollamaModel').value = settings.ollamaModel;
    toggleOllamaCfg();
    $('rateVal').textContent = settings.rate;
    $('duckVal').textContent = `${Math.round(settings.duckLevel * 100)}%`;

    fillVoices(settings.targetLang);
    speechSynthesis.onvoiceschanged = () => fillVoices($('targetLang').value);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    $('toggle').addEventListener('click', async () => {
      if (!activeTab) return;
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'DUBAI_TOGGLE' });
      } catch (e) {}
      setTimeout(refreshState, 400);
    });

    for (const id of ['targetLang', 'sourceLang', 'voice', 'voiceBackend', 'xttsUrl', 'xttsReference', 'rate', 'duck', 'duckLevel', 'showSubs', 'whisperFallback', 'translatorBackend', 'ollamaUrl', 'ollamaModel']) {
      $(id).addEventListener('change', () => {
        if (id === 'targetLang') fillVoices($('targetLang').value);
        if (id === 'translatorBackend') toggleOllamaCfg();
        if (id === 'voiceBackend') toggleVoiceCfg();
        apply();
      });
      if (id === 'rate' || id === 'duckLevel') $(id).addEventListener('input', apply);
    }

    $('testOllama').addEventListener('click', testOllama);
    $('testXtts').addEventListener('click', testXtts);

    $('hint').textContent =
      'Funciona en YouTube, Udemy, Coursera, Vimeo, Bilibili, LinkedIn Learning, edX y más. Traducción 100% local (Chrome, transformers.js u Ollama).';

    refreshState();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
