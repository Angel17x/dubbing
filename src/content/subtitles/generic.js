// DubAI — extractor genérico de subtítulos para cualquier plataforma con video HTML5
// Estrategia (con reintentos mientras el player carga las pistas):
//   1) TextTrack API del <video> (forzando la carga con mode='hidden')
//   2) <track src="..."> vía background (evita CORS del CDN)
//   3) URLs .vtt capturadas por el net-hook (peticiones del propio player)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  function pageId() {
    return location.hostname + location.pathname;
  }

  function waitCues(track, timeout = 4000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        if (track.cues && track.cues.length) return resolve(track.cues);
        if (Date.now() - t0 > timeout) return resolve(null);
        setTimeout(poll, 250);
      })();
    });
  }

  function pickTextTrack(video, sourceLang) {
    const tracks = Array.from(video.textTracks || []).filter((t) => t.kind === 'captions' || t.kind === 'subtitles');
    if (!tracks.length) return null;
    if (sourceLang && sourceLang !== 'auto') {
      const exact = tracks.find((t) => (t.language || '').toLowerCase().startsWith(sourceLang));
      if (exact) return exact;
    }
    return tracks.find((t) => t.mode !== 'disabled') || tracks[0];
  }

  function mapCues(cues) {
    return Array.from(cues)
      .map((c) => ({
        start: c.startTime,
        end: c.endTime,
        text: c.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      }))
      .filter((c) => c.text);
  }

  function requestVttUrls(timeout = 1200) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve([]);
      }, timeout);
      function onMsg(ev) {
        if (ev.source !== window || !ev.data || ev.data.source !== 'DUBAI_HOOK' || ev.data.type !== 'VTT_URLS') return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(ev.data.urls || []);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'DUBAI_CONTENT', type: 'REQUEST_VTT_URLS' }, '*');
    });
  }

  function guessLangFromUrl(u) {
    const m = String(u).match(/[\/._-]([a-z]{2})(?:[-_][a-zA-Z]{2,4})?[\/._?-]/i);
    return m ? m[1].toLowerCase() : null;
  }

  function preferLang(urls, sourceLang) {
    if (!sourceLang || sourceLang === 'auto') return urls;
    const scored = urls.map((u) => {
      const l = guessLangFromUrl(u);
      return { u, score: l === sourceLang ? 0 : l ? 1 : 2 };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.u);
  }

  async function fetchVtt(url) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DUBAI_FETCH', url });
      if (res && res.ok && res.text && /WEBVTT/i.test(res.text)) {
        const cues = D.parsers.parseVtt(res.text);
        return cues.length ? cues : null;
      }
    } catch (e) {
      D.warn('fallo descargando VTT', url, e);
    }
    return null;
  }

  async function tryOnce(settings, video, id) {
    // 1) TextTrack API — 'hidden' fuerza la descarga del VTT sin mostrarlo
    const track = pickTextTrack(video, settings.sourceLang);
    if (track) {
      if (track.mode === 'disabled') track.mode = 'hidden';
      const cues = await waitCues(track);
      const list = cues && mapCues(cues);
      if (list && list.length) {
        return { videoId: id, lang: (track.language || '').split('-')[0] || null, cues: list };
      }
    }

    // 2) <track src="...">
    const trackEls = Array.from(document.querySelectorAll('video track[src]'));
    for (const el of trackEls) {
      const cues = await fetchVtt(el.src);
      if (cues) return { videoId: id, lang: (el.srclang || '').split('-')[0] || guessLangFromUrl(el.src), cues };
    }

    // 3) URLs sniffadas por el net-hook (peticiones del propio reproductor)
    const urls = preferLang(await requestVttUrls(), settings.sourceLang);
    for (const u of urls) {
      const cues = await fetchVtt(u);
      if (cues) return { videoId: id, lang: guessLangFromUrl(u), cues };
    }

    return null;
  }

  const generic = {
    async getCues(settings) {
      const video = await D.waitForVideo();
      const id = pageId();

      // Reintentos: muchos players (Udemy incluido) cargan las pistas tarde o al dar play
      const deadline = Date.now() + 15000;
      let result = await tryOnce(settings, video, id);
      while (!result && Date.now() < deadline) {
        await D.sleep(1200);
        result = await tryOnce(settings, video, id);
      }
      return result || { videoId: id, lang: null, cues: [] };
    }
  };

  D.subtitles = D.subtitles || {};
  D.subtitles.generic = generic;
})(window.DubAI);
