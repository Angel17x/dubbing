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
    videoVolume: 1.0, duck: true, duckLevel: 0.25, showSubs: true, autoSummary: true,
    whisperFallback: false, translatorBackend: 'auto',
    ollamaUrl: 'http://localhost:11434', ollamaModel: 'llama3.1:8b',
    ollamaModelUpgradeV1: false,
    voiceBackend: 'xtts', xttsUrl: 'http://127.0.0.1:8020',
    xttsReference: ''
  };

  const $ = (id) => document.getElementById(id);
  const MEMORY_KEY = 'dubaiTranslationMemoryV1';
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
      videoVolume: parseFloat($('videoVolume').value),
      duck: $('duck').checked,
      duckLevel: parseFloat($('duckLevel').value),
      showSubs: $('showSubs').checked,
      autoSummary: $('autoSummary').checked,
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
    $('videoVolumeVal').textContent = `${Math.round(settings.videoVolume * 100)}%`;
    $('duckVal').textContent = `${Math.round(settings.duckLevel * 100)}%`;
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'DUBAI_SETTINGS', settings }).catch(() => {});
    }
  }

  async function loadMemory() {
    const stored = await chrome.storage.local.get(MEMORY_KEY);
    const memory = stored[MEMORY_KEY] || { glossary: [], corrections: [] };
    $('glossary').value = (memory.glossary || [])
      .map((entry) => `${entry.source} = ${entry.target || entry.source}`)
      .join('\n');
    $('memoryStatus').textContent = `${(memory.glossary || []).length} reglas · ${(memory.corrections || []).length} correcciones aprendidas`;
    return memory;
  }

  async function saveGlossary() {
    const stored = await chrome.storage.local.get(MEMORY_KEY);
    const memory = stored[MEMORY_KEY] || { corrections: [] };
    const glossary = $('glossary').value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        const source = (separator >= 0 ? line.slice(0, separator) : line).trim();
        const target = (separator >= 0 ? line.slice(separator + 1) : line).trim() || source;
        return { source, target };
      })
      .filter((entry) => entry.source)
      .slice(0, 200);
    await chrome.storage.local.set({
      [MEMORY_KEY]: {
        glossary,
        corrections: memory.corrections || [],
        updatedAt: Date.now()
      }
    });
    await loadMemory();
    $('memoryStatus').textContent += ' · ✔ guardado; reactiva el doblaje';
  }

  async function clearCorrections() {
    if (!confirm('¿Borrar todas las correcciones aprendidas? El glosario se conservará.')) return;
    const stored = await chrome.storage.local.get(MEMORY_KEY);
    const memory = stored[MEMORY_KEY] || {};
    await chrome.storage.local.set({
      [MEMORY_KEY]: { glossary: memory.glossary || [], corrections: [], updatedAt: Date.now() }
    });
    await loadMemory();
  }

  async function clearVideoKnowledge() {
    if (!confirm('¿Borrar todas las transcripciones, resúmenes y conversaciones guardadas?')) return;
    const indexKey = 'dubai:knowledge:index:v1';
    const stored = await chrome.storage.local.get(indexKey);
    const index = Array.isArray(stored[indexKey]) ? stored[indexKey] : [];
    await chrome.storage.local.remove(index.map((item) => item.key).concat(indexKey));
    $('assistantStatus').textContent = 'Historial del asistente eliminado ✔';
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
    $('videoVolume').value = settings.videoVolume;
    $('duck').checked = settings.duck;
    $('duckLevel').value = settings.duckLevel;
    $('showSubs').checked = settings.showSubs;
    $('autoSummary').checked = settings.autoSummary;
    $('whisperFallback').checked = settings.whisperFallback;
    $('translatorBackend').value = settings.translatorBackend;
    $('ollamaUrl').value = settings.ollamaUrl;
    $('ollamaModel').value = settings.ollamaModel;
    toggleOllamaCfg();
    $('rateVal').textContent = settings.rate;
    $('videoVolumeVal').textContent = `${Math.round(settings.videoVolume * 100)}%`;
    $('duckVal').textContent = `${Math.round(settings.duckLevel * 100)}%`;

    fillVoices(settings.targetLang);
    speechSynthesis.onvoiceschanged = () => fillVoices($('targetLang').value);
    await loadMemory();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    $('toggle').addEventListener('click', async () => {
      if (!activeTab) return;
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'DUBAI_TOGGLE' });
      } catch (e) {}
      setTimeout(refreshState, 400);
    });

    for (const id of ['targetLang', 'sourceLang', 'voice', 'voiceBackend', 'xttsUrl', 'xttsReference', 'rate', 'videoVolume', 'duck', 'duckLevel', 'showSubs', 'autoSummary', 'whisperFallback', 'translatorBackend', 'ollamaUrl', 'ollamaModel']) {
      $(id).addEventListener('change', () => {
        if (id === 'targetLang') fillVoices($('targetLang').value);
        if (id === 'translatorBackend') toggleOllamaCfg();
        if (id === 'voiceBackend') toggleVoiceCfg();
        apply();
      });
      if (id === 'rate' || id === 'videoVolume' || id === 'duckLevel') $(id).addEventListener('input', apply);
    }

    $('testOllama').addEventListener('click', testOllama);
    $('testXtts').addEventListener('click', testXtts);
    $('saveGlossary').addEventListener('click', saveGlossary);
    $('clearCorrections').addEventListener('click', clearCorrections);
    $('clearVideoKnowledge').addEventListener('click', clearVideoKnowledge);

    $('hint').textContent =
      'Funciona en YouTube, Udemy, Coursera, Vimeo, Bilibili, LinkedIn Learning, edX y más. Traducción 100% local (Chrome, transformers.js u Ollama).';

    refreshState();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
