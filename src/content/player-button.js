// DubAI — botón integrado en la barra de controles del reproductor de YouTube (estilo Trancy)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  let observer = null;

  const ICON =
    '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>' +
    '<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>' +
    '</svg>';

  function createButton() {
    const b = document.createElement('button');
    b.className = 'ytp-button dubai-player-btn';
    b.id = 'dubai-player-btn';
    b.title = 'DubAI: activar / detener doblaje IA';
    b.setAttribute('aria-label', 'DubAI: activar / detener doblaje IA');
    b.innerHTML = ICON;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      D.engine.toggle();
    });
    return b;
  }

  function doInject() {
    if (D.currentSite() !== 'youtube') return;
    if (document.getElementById('dubai-player-btn')) return;
    const controls = document.querySelector('.ytp-right-controls');
    if (!controls) return;
    controls.prepend(createButton());
    D.playerButton.setActive(['loading', 'ready', 'whisper'].includes(D.engine.state));
    D.log('botón integrado en la barra del reproductor');
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
      const b = document.getElementById('dubai-player-btn');
      if (b) b.classList.toggle('dubai-on', !!on);
    }
  };

  D.playerButton = playerButton;
})(window.DubAI);
