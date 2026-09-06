// DubAI — base de conocimiento local por video para resumen y preguntas
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  const PREFIX = 'dubai:knowledge:v1:';
  const INDEX_KEY = 'dubai:knowledge:index:v1';
  const MAX_VIDEOS = 30;
  const STOP_WORDS = new Set(
    'a al algo como con cual de del el ella en es esa ese esto esta este la las lo los para por que qué se si sin sobre su sus un una y yo the a an and are as at be by for from how in is it of on or that this to what when where which who why with'.split(
      ' '
    )
  );

  function storageKey(mediaKey) {
    return PREFIX + mediaKey;
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function normalizeCues(cues) {
    return (cues || [])
      .filter((cue) => cue && (cue.es || cue.text))
      .map((cue) => ({
        start: Math.max(0, Number(cue.start) || 0),
        end: Math.max(Number(cue.end) || 0, Number(cue.start) || 0),
        source: String(cue.text || '').trim(),
        text: String(cue.es || cue.text || '').trim()
      }));
  }

  function buildChunks(cues) {
    const chunks = [];
    let current = null;
    for (const cue of cues) {
      if (!current) current = { start: cue.start, end: cue.end, lines: [] };
      current.end = Math.max(current.end, cue.end);
      current.lines.push(`[${formatTime(cue.start)}] ${cue.text}`);
      const duration = current.end - current.start;
      const chars = current.lines.reduce((total, line) => total + line.length, 0);
      if (duration >= 45 || chars >= 3200) {
        chunks.push({ start: current.start, end: current.end, text: current.lines.join('\n') });
        current = null;
      }
    }
    if (current && current.lines.length) {
      chunks.push({ start: current.start, end: current.end, text: current.lines.join('\n') });
    }
    return chunks;
  }

  async function load(mediaKey = D.mediaKey()) {
    const key = storageKey(mediaKey);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async function pruneIndex(currentKey) {
    const stored = await chrome.storage.local.get(INDEX_KEY);
    const index = Array.isArray(stored[INDEX_KEY]) ? stored[INDEX_KEY] : [];
    const next = [{ key: currentKey, updatedAt: Date.now() }]
      .concat(index.filter((item) => item && item.key !== currentKey))
      .slice(0, MAX_VIDEOS);
    const remove = index
      .filter((item) => item && !next.some((kept) => kept.key === item.key))
      .map((item) => item.key);
    if (remove.length) await chrome.storage.local.remove(remove);
    await chrome.storage.local.set({ [INDEX_KEY]: next });
  }

  async function saveRecord(record) {
    const key = storageKey(record.mediaKey);
    record.updatedAt = Date.now();
    await pruneIndex(key);
    try {
      await chrome.storage.local.set({ [key]: record });
    } catch (error) {
      // Si Chrome alcanzó la cuota, liberar cinco videos antiguos y reintentar.
      const stored = await chrome.storage.local.get(INDEX_KEY);
      const index = Array.isArray(stored[INDEX_KEY]) ? stored[INDEX_KEY] : [];
      const victims = index.slice(-5).filter((item) => item.key !== key);
      if (!victims.length) throw error;
      await chrome.storage.local.remove(victims.map((item) => item.key));
      await chrome.storage.local.set({ [INDEX_KEY]: index.filter((item) => !victims.includes(item)) });
      await chrome.storage.local.set({ [key]: record });
    }
    return record;
  }

  async function captureEngine(engine, mode) {
    if (!engine || !engine.video) return null;
    const mediaKey = (engine.videoMeta && engine.videoMeta.mediaKey) || D.mediaKey();
    let sourceCues = engine.cues || [];
    if ((!sourceCues || !sourceCues.length) && engine.whisper && engine.whisper.segments) {
      sourceCues = engine.whisper.segments;
    }
    const cues = normalizeCues(sourceCues);
    if (!cues.length) return load(mediaKey);
    const previous = await load(mediaKey);
    const transcriptUnchanged = !!(previous && previous.cues && previous.cues.length === cues.length);
    const record = {
      version: 1,
      mediaKey,
      videoId: (engine.videoMeta && engine.videoMeta.videoId) || mediaKey,
      title: (engine.videoMeta && engine.videoMeta.title) || document.title || mediaKey,
      url: (engine.videoMeta && engine.videoMeta.url) || location.href,
      sourceLang: (engine.videoMeta && engine.videoMeta.sourceLang) || (engine.settings && engine.settings.sourceLang) || 'auto',
      targetLang: (engine.settings && engine.settings.targetLang) || 'es',
      duration: Number(engine.video.duration) || (cues[cues.length - 1] && cues[cues.length - 1].end) || 0,
      mode: mode || (engine.whisper && engine.whisper.active ? 'whisper' : 'subtitles'),
      cues,
      chunks: buildChunks(cues),
      summary: transcriptUnchanged && previous.summary ? previous.summary : '',
      messages: previous && Array.isArray(previous.messages) ? previous.messages.slice(-50) : [],
      createdAt: (previous && previous.createdAt) || Date.now(),
      updatedAt: Date.now()
    };
    return saveRecord(record);
  }

  async function update(mediaKey, changes) {
    const record = (await load(mediaKey)) || {
      version: 1,
      mediaKey,
      title: document.title || mediaKey,
      url: location.href,
      cues: [],
      chunks: [],
      messages: [],
      createdAt: Date.now()
    };
    Object.assign(record, changes);
    if (Array.isArray(record.messages)) record.messages = record.messages.slice(-50);
    return saveRecord(record);
  }

  function tokens(text) {
    return (String(text || '').toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []).filter(
      (token) => !STOP_WORDS.has(token)
    );
  }

  function selectRelevant(record, question, currentTime = 0) {
    const chunks = (record && record.chunks) || [];
    if (!chunks.length) return [];
    const query = tokens(question);
    const scored = chunks.map((chunk, index) => {
      const haystack = String(chunk.text || '').toLocaleLowerCase();
      let score = 0;
      for (const token of query) {
        const matches = haystack.split(token).length - 1;
        score += matches * (token.length >= 6 ? 3 : 1);
      }
      if (currentTime >= chunk.start && currentTime <= chunk.end) score += query.length ? 1 : 10;
      return { index, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const chosen = new Set();
    for (const item of scored.slice(0, 5)) {
      if (item.score <= 0 && chosen.size) continue;
      chosen.add(item.index);
      if (item.index > 0) chosen.add(item.index - 1);
      if (item.index + 1 < chunks.length) chosen.add(item.index + 1);
      if (chosen.size >= 8) break;
    }
    if (!chosen.size) {
      const current = chunks.findIndex((chunk) => currentTime >= chunk.start && currentTime <= chunk.end);
      chosen.add(current >= 0 ? current : 0);
    }
    return Array.from(chosen)
      .sort((a, b) => a - b)
      .map((index) => chunks[index])
      .filter(Boolean);
  }

  async function clearAll() {
    const stored = await chrome.storage.local.get(INDEX_KEY);
    const index = Array.isArray(stored[INDEX_KEY]) ? stored[INDEX_KEY] : [];
    await chrome.storage.local.remove(index.map((item) => item.key).concat(INDEX_KEY));
  }

  D.videoKnowledge = {
    formatTime,
    buildChunks,
    load,
    update,
    captureEngine,
    selectRelevant,
    clearAll
  };
})(window.DubAI);
