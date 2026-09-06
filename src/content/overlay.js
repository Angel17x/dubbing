// DubAI — overlay flotante en la página: botón de doblaje, estado, progreso y subtítulos traducidos
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  let root, btn, status, barFill, capWrap, capBox, correctBtn, whisperBtn;
  let correctionSource = '';
  let correctionText = '';

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
        <div id="dubai-caption-wrap">
          <div id="dubai-captions"></div>
          <button id="dubai-correct" title="Corregir y enseñar esta traducción">✏️</button>
        </div>`;
      document.documentElement.appendChild(root);

      btn = root.querySelector('#dubai-toggle');
      status = root.querySelector('#dubai-status');
      barFill = root.querySelector('#dubai-bar-fill');
      capWrap = root.querySelector('#dubai-caption-wrap');
      capBox = root.querySelector('#dubai-captions');
      correctBtn = root.querySelector('#dubai-correct');
      whisperBtn = root.querySelector('#dubai-whisper');

      btn.addEventListener('click', () => D.engine.toggle());
      whisperBtn.addEventListener('click', () => D.engine.enableWhisperAndStart());
      correctBtn.addEventListener('click', () => {
        if (!correctionSource || !correctionText) return;
        const corrected = prompt('Corrige la traducción. DubAI la recordará localmente:', correctionText);
        if (corrected && corrected.trim() && corrected.trim() !== correctionText) {
          D.engine.saveCorrection(correctionSource, corrected.trim());
        }
      });
    },

    setStatus(t) {
      if (status) status.textContent = t || '';
    },
    setProgress(f) {
      if (barFill) barFill.style.width = `${Math.round(D.clamp(f || 0, 0, 1) * 100)}%`;
    },
    setCaption(t, source = '') {
      if (capBox) {
        capBox.textContent = t || '';
        correctionText = t || '';
        correctionSource = source || '';
        if (capWrap) capWrap.style.display = t ? 'flex' : 'none';
        if (correctBtn) correctBtn.style.display = t && source ? 'block' : 'none';
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
