// DubAI — extractor de subtítulos de YouTube (ytInitialPlayerResponse + timedtext JSON3)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  function videoId() {
    // /watch?v=ID | /embed/ID | /shorts/ID | /live/ID
    const q = new URLSearchParams(location.search).get('v');
    if (q) return q;
    const m = location.pathname.match(/\/(embed|shorts|live)\/([\w-]{4,})/);
    return m ? m[2] : null;
  }

  function injectHook() {
    if (document.documentElement.hasAttribute('data-dubai-hook')) return;
    document.documentElement.setAttribute('data-dubai-hook', '1');
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/content/page-hook.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  // Pide los caption tracks al hook de página; si falla, descarga el HTML del watch y lo parsea
  function getCaptionTracks() {
    return new Promise((resolve) => {
      let done = false;
      let poll = null;
      const finish = (val) => {
        if (!done) {
          done = true;
          clearInterval(poll);
          window.removeEventListener('message', onMsg);
          resolve(val);
        }
      };
      function onMsg(ev) {
        if (ev.source !== window || !ev.data || ev.data.source !== 'DUBAI_HOOK' || ev.data.type !== 'CAPTION_TRACKS') return;
        if (ev.data.videoId && videoId() && ev.data.videoId !== videoId()) return; // respuesta de otro video
        // Una respuesta vacía puede llegar antes de que el player termine de
        // inicializarse; no finalizar, seguir consultando.
        if (ev.data.tracks && ev.data.tracks.length) finish(ev.data.tracks);
      }
      window.addEventListener('message', onMsg);
      injectHook();
      const request = () => window.postMessage({ source: 'DUBAI_CONTENT', type: 'REQUEST_TRACKS' }, '*');
      setTimeout(request, 100);
      poll = setInterval(request, 500);
      setTimeout(() => finish(null), 7000);
    }).then(async (tracks) => {
      if (tracks) return tracks;
      return fetchFallback();
    });
  }

  // Extrae el array "captionTracks" del HTML del watch con un parser por balanceo de corchetes
  async function fetchFallback() {
    try {
      const html = await fetch(location.href, { credentials: 'include' }).then((r) => r.text());
      const arr = extractJsonArray(html, '"captionTracks"');
      return arr ? JSON.parse(arr) : null;
    } catch (e) {
      D.warn('fallback captionTracks falló', e);
      return null;
    }
  }

  function extractJsonArray(text, key) {
    const i = text.indexOf(key);
    if (i < 0) return null;
    const j = text.indexOf('[', i + key.length);
    if (j < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let k = j; k < text.length; k++) {
      const c = text[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) return text.slice(j, k + 1);
      }
    }
    return null;
  }

  function pickTrack(tracks, sourceLang) {
    if (!tracks || !tracks.length) return null;
    if (sourceLang && sourceLang !== 'auto') {
      const exact = tracks.find((t) => t.languageCode === sourceLang);
      if (exact) return exact;
      const prefix = tracks.find((t) => (t.languageCode || '').startsWith(sourceLang));
      if (prefix) return prefix;
    }
    // Preferir pista manual sobre ASR si existe
    return tracks.find((t) => t.kind !== 'asr') || tracks[0];
  }

  const youtube = {
    videoId,
    async getCues(settings) {
      const tracks = await getCaptionTracks();
      const track = pickTrack(tracks, settings.sourceLang);
      if (track && track.baseUrl) {
        try {
          const url = new URL(track.baseUrl);
          url.searchParams.set('fmt', 'json3');
          const response = await fetch(url.href, { credentials: 'include' });
          if (!response.ok) throw new Error(`timedtext HTTP ${response.status}`);
          const json = await response.json();
          const cues = D.parsers.parseYoutubeJson3(json, track.kind === 'asr');
          if (cues.length) {
            return { videoId: videoId(), lang: (track.languageCode || '').split('-')[0], cues };
          }
        } catch (e) {
          D.warn('No se pudo leer timedtext JSON3', e);
        }
      }

      // Último recurso: TextTrack/VTT. Es útil en embeds y en variantes nuevas
      // del reproductor donde YouTube no expone captionTracks.
      if (D.subtitles.generic) {
        const generic = await D.subtitles.generic.getCues(settings);
        if (generic.cues && generic.cues.length) {
          generic.videoId = videoId() || generic.videoId;
          return generic;
        }
      }
      return { videoId: videoId(), lang: null, cues: [] };
    }
  };

  D.subtitles = D.subtitles || {};
  D.subtitles.youtube = youtube;
})(window.DubAI);
