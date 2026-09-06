// DubAI — botón integrado en la barra inferior del reproductor (estilo Trancy)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  let observer = null;
  let active = false;
  let status = '';
  let progress = 0;
  let whisperOffered = false;

  const ICON =
    '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>' +
    '<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>' +
    '</svg>';

  function createButton(youtube) {
    const b = document.createElement('button');
    b.className = (youtube ? 'ytp-button ' : '') + 'dubai-player-btn' + (youtube ? '' : ' dubai-generic-player-btn');
    b.id = 'dubai-player-btn';
    b.setAttribute('aria-label', 'DubAI: activar / detener doblaje IA');
    b.innerHTML = ICON;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (whisperOffered) D.engine.enableWhisperAndStart();
      else D.engine.toggle();
    });
    updateButton(b);
    return b;
  }

  function updateButton(button = document.getElementById('dubai-player-btn')) {
    if (!button) return;
    button.classList.toggle('dubai-on', active);
    button.classList.toggle('dubai-whisper-ready', whisperOffered);
    button.style.setProperty('--dubai-progress', `${Math.round(D.clamp(progress, 0, 1) * 100)}%`);
    const action = whisperOffered ? 'Pulsa para doblar con Whisper' : active ? 'Pulsa para detener' : 'Pulsa para activar';
    button.title = status ? `DubAI — ${status}\n${action}` : `DubAI — ${action}`;
  }

  function findGenericControls(video) {
    const selectors = [
      '[data-purpose="video-controls"]',
      '[data-purpose="control-bar"]',
      '.vjs-control-bar',
      '.plyr__controls',
      '.jw-controlbar',
      '.shaka-controls-button-panel',
      '.video-controls'
    ];
    const vr = video.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
    return (
      candidates.find((node) => {
        const r = node.getBoundingClientRect();
        return r.width > vr.width * 0.45 && Math.abs(r.bottom - vr.bottom) < Math.max(90, vr.height * 0.2);
      }) || null
    );
  }

  function injectGeneric() {
    const video = document.querySelector('video');
    if (!video) return;
    const controls = findGenericControls(video);
    if (controls) {
      controls.appendChild(createButton(false));
      D.log('botón integrado en los controles del reproductor');
      return;
    }

    // Respaldo para players propietarios: anclar visualmente el botón a la
    // esquina inferior del contenedor, no a la ventana del navegador.
    const container =
      video.closest('[data-purpose*="video-player"], .video-player, .vjs-player, .plyr, .jwplayer') ||
      video.parentElement;
    if (!container) return;
    if (getComputedStyle(container).position === 'static') container.classList.add('dubai-player-anchor');
    const button = createButton(false);
    button.classList.add('dubai-player-fallback');
    container.appendChild(button);
    D.log('botón anclado a la barra inferior del video');
  }

  function doInject() {
    if (document.getElementById('dubai-player-btn')) return;
    if (D.currentSite() === 'youtube') {
      const controls = document.querySelector('.ytp-right-controls');
      if (!controls) return;
      controls.prepend(createButton(true));
      D.log('botón integrado en la barra de YouTube');
    } else {
      injectGeneric();
    }
  }

  const playerButton = {
    inject() {
      doInject();
      // YouTube re-renderiza los controles a menudo: re-inyectar si el botón desaparece
      if (!observer) {
        let scheduled = false;
        observer = new MutationObserver(() => {
          if (scheduled) return;
          scheduled = true;
          setTimeout(() => {
            scheduled = false;
            if (!document.getElementById('dubai-player-btn')) doInject();
          }, 400);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    },

    setActive(on) {
      active = !!on;
      updateButton();
    },

    setStatus(value) {
      status = value || '';
      updateButton();
    },

    setProgress(value) {
      progress = value || 0;
      updateButton();
    },

    showWhisperOption(on) {
      whisperOffered = !!on;
      updateButton();
    }
  };

  D.playerButton = playerButton;
})(window.DubAI);
