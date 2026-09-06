// DubAI — overlay flotante en la página: botón de doblaje, estado, progreso y subtítulos traducidos
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  let root, capWrap, capBox, correctBtn;
  let correctionSource = '';
  let correctionText = '';

  const overlay = {
    create() {
      if (document.getElementById('dubai-root')) return;
      root = document.createElement('div');
      root.id = 'dubai-root';
      root.innerHTML = `
        <div id="dubai-caption-wrap">
          <div id="dubai-captions"></div>
          <button id="dubai-correct" title="Corregir y enseñar esta traducción">✏️</button>
        </div>`;
      document.documentElement.appendChild(root);

      capWrap = root.querySelector('#dubai-caption-wrap');
      capBox = root.querySelector('#dubai-captions');
      correctBtn = root.querySelector('#dubai-correct');

      correctBtn.addEventListener('click', () => {
        if (!correctionSource || !correctionText) return;
        const corrected = prompt('Corrige la traducción. DubAI la recordará localmente:', correctionText);
        if (corrected && corrected.trim() && corrected.trim() !== correctionText) {
          D.engine.saveCorrection(correctionSource, corrected.trim());
        }
      });
    },

    setStatus(t) {
      if (D.playerButton) D.playerButton.setStatus(t || '');
    },
    setProgress(f) {
      if (D.playerButton) D.playerButton.setProgress(f || 0);
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
      if (D.playerButton) D.playerButton.setActive(on);
    },
    showWhisperOption(on) {
      if (D.playerButton) D.playerButton.showWhisperOption(on);
    }
  };

  D.overlay = overlay;
})(window.DubAI);
