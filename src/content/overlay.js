// DubAI — overlay flotante en la página: botón de doblaje, estado, progreso y subtítulos traducidos
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  let root, btn, status, barFill, capBox, whisperBtn;

  const overlay = {
    create() {
      if (document.getElementById('dubai-root')) return;
      root = document.createElement('div');
      root.id = 'dubai-root';
      root.innerHTML = `
        <div id="dubai-panel">
          <button id="dubai-toggle" title="Activar / detener doblaje IA">🎙️ <span>DubAI</span></button>
          <button id="dubai-whisper" title="Transcribir el audio con Whisper local y doblar">✨ Doblar con Whisper</button>
          <div id="dubai-info">
            <div id="dubai-status"></div>
            <div id="dubai-bar"><div id="dubai-bar-fill"></div></div>
          </div>
        </div>
        <div id="dubai-captions"></div>`;
      document.documentElement.appendChild(root);

      btn = root.querySelector('#dubai-toggle');
      status = root.querySelector('#dubai-status');
      barFill = root.querySelector('#dubai-bar-fill');
      capBox = root.querySelector('#dubai-captions');
      whisperBtn = root.querySelector('#dubai-whisper');

      btn.addEventListener('click', () => D.engine.toggle());
      whisperBtn.addEventListener('click', () => D.engine.enableWhisperAndStart());
    },

    setStatus(t) {
      if (status) status.textContent = t || '';
    },
    setProgress(f) {
      if (barFill) barFill.style.width = `${Math.round(D.clamp(f || 0, 0, 1) * 100)}%`;
    },
    setCaption(t) {
      if (capBox) {
        capBox.textContent = t || '';
        capBox.style.display = t ? 'block' : 'none';
      }
    },
    setActive(on) {
      if (btn) btn.classList.toggle('active', !!on);
      if (D.playerButton) D.playerButton.setActive(on);
    },
    showWhisperOption(on) {
      if (whisperBtn) whisperBtn.style.display = on ? 'inline-flex' : 'none';
    }
  };

  D.overlay = overlay;
})(window.DubAI);
