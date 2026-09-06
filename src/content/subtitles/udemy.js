// DubAI — extractor de subtítulos de Udemy (usa el extractor genérico: textTracks/VTT)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  D.subtitles = D.subtitles || {};
  D.subtitles.udemy = {
    getCues(settings) {
      return D.subtitles.generic.getCues(settings);
    }
  };
})(window.DubAI);
