// DubAI — bootstrap del content script: overlay, mensajes y navegación SPA
(function (D) {
  'use strict';

  let lastMediaKey = D.mediaKey();
  let restartTimer = null;
  let pendingRestart = false;

  async function boot() {
    const isTop = window.top === window;
    if (!isTop) {
      // En iframes (p. ej. YouTube embed en una plataforma de cursos):
      // solo arrancar si aparece un <video>; si no, este frame no participa
      try {
        await D.waitForVideo(10000);
      } catch (e) {
        return;
      }
      D.log('iframe con video detectado:', location.href);
    }

    D.overlay.create();
    D.tts.init();
    if (D.playerButton) D.playerButton.inject();

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      (async () => {
        try {
          switch (msg.type) {
            case 'DUBAI_STATUS':
              // Si este frame no tiene video ni motor activo, que responda otro frame
              if (!document.querySelector('video') && D.engine.state === 'idle') return;
              sendResponse({ ok: true, state: D.engine.state });
              break;
            case 'DUBAI_TOGGLE':
              if (!document.querySelector('video')) {
                sendResponse({ ok: false, noVideo: true });
                return;
              }
              await D.engine.toggle();
              sendResponse({ ok: true, state: D.engine.state });
              break;
            case 'DUBAI_SETTINGS':
              D.engine.onSettings(msg.settings || {});
              sendResponse({ ok: true });
              break;
            case 'DUBAI_WHISPER_SEGMENT':
              D.engine.onWhisperSegment(msg.segment);
              sendResponse({ ok: true });
              break;
            case 'DUBAI_WHISPER_STATUS':
              if (D.engine.state === 'whisper' && (!D.engine.video || !D.engine.video.paused)) {
                D.overlay.setStatus(msg.status || 'Whisper escuchando…');
              }
              sendResponse({ ok: true });
              break;
            case 'DUBAI_PROGRESS':
              // Solo el frame que está traduciendo actualiza su overlay
              if (D.engine.state === 'loading') {
                D.overlay.setStatus(`Traduciendo ${msg.done}/${msg.total}`);
                D.overlay.setProgress(msg.total ? msg.done / msg.total : 0);
              }
              sendResponse({ ok: true });
              break;
            default:
              sendResponse({ ok: false });
          }
        } catch (e) {
          sendResponse({ ok: false, error: String((e && e.message) || e) });
        }
      })();
      return true; // respuesta asíncrona
    });

    // YouTube y Udemy son SPAs: cancelar inmediatamente el contenido anterior
    // y reiniciar una sola vez cuando se estabilice la identidad del nuevo video.
    setInterval(() => {
      const mediaKey = D.mediaKey();
      if (mediaKey === lastMediaKey) return;
      lastMediaKey = mediaKey;
      clearTimeout(restartTimer);
      if (['loading', 'ready', 'whisper'].includes(D.engine.state)) pendingRestart = true;
      if (pendingRestart) {
        D.log('nuevo video detectado, descartando doblaje anterior');
        D.engine.stop();
        const expectedKey = mediaKey;
        restartTimer = setTimeout(() => {
          if (!pendingRestart || D.mediaKey() !== expectedKey) return;
          pendingRestart = false;
          if (D.playerButton) D.playerButton.inject();
          D.engine.start();
        }, 1200);
      } else if (D.playerButton) {
        D.playerButton.inject();
      }
    }, 400);

    D.log('content script listo en', location.hostname);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.DubAI);
