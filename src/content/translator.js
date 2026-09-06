// DubAI — traducción local: Chrome Translator API (on-device) con fallback a transformers.js en offscreen
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  // Soporta la API nueva (self.Translator) y la antigua de origin trial (self.translation)
  function getNativeApi() {
    if (self.Translator) {
      return {
        availability: (o) => self.Translator.availability(o),
        create: (o) => self.Translator.create(o)
      };
    }
    if (self.translation && self.translation.createTranslator) {
      return {
        availability: async (o) => {
          const r = await self.translation.canTranslate(o);
          return r === 'readily' ? 'available' : r === 'after-download' ? 'downloadable' : 'unavailable';
        },
        create: (o) => self.translation.createTranslator(o)
      };
    }
    return null;
  }

  const translator = {
    settings: null,
    _instance: null,
    _src: null,
    _tgt: null,

    async _relevantMemory(texts, tgt) {
      try {
        const stored = await chrome.storage.local.get('dubaiTranslationMemoryV1');
        const memory = stored.dubaiTranslationMemoryV1 || {};
        const joined = texts.join(' ').toLocaleLowerCase();
        const glossary = (memory.glossary || [])
          .filter((entry) => entry && entry.source && joined.includes(String(entry.source).toLocaleLowerCase()))
          .slice(0, 80);
        const tokens = new Set(joined.match(/[\p{L}\p{N}_-]{4,}/gu) || []);
        const corrections = (memory.corrections || [])
          .filter((entry) => entry && entry.source && entry.target && (!entry.tgt || entry.tgt === tgt))
          .map((entry) => {
            const source = String(entry.source).toLocaleLowerCase();
            const overlap = (source.match(/[\p{L}\p{N}_-]{4,}/gu) || []).filter((token) => tokens.has(token)).length;
            return { entry, score: joined.includes(source) ? 100 : overlap };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0))
          .slice(0, 12)
          .map((item) => item.entry);
        return { glossary, corrections };
      } catch (e) {
        return { glossary: [], corrections: [] };
      }
    },

    async detect(text) {
      try {
        const LD = self.LanguageDetector || (self.ai && self.ai.languageDetector);
        if (!LD || !text) return null;
        const det = await LD.create();
        const res = await det.detect(text);
        const code = res && res[0] && res[0].detectedLanguage;
        return code ? code.split('-')[0] : null;
      } catch (e) {
        return null;
      }
    },

    async _initNative(src, tgt) {
      const api = getNativeApi();
      if (!api) return false;
      let avail;
      try {
        avail = await api.availability({ sourceLanguage: src, targetLanguage: tgt });
      } catch (e) {
        return false;
      }
      if (avail === 'unavailable' || avail === 'no') return false;
      this._instance = await api.create({
        sourceLanguage: src,
        targetLanguage: tgt,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            D.overlay.setStatus(`Descargando modelo de traducción ${Math.round((e.loaded || 0) * 100)}%`);
          });
        }
      });
      return true;
    },

    async _translateNative(texts, onProgress) {
      const out = new Array(texts.length);
      const CONC = 4;
      let idx = 0, done = 0, failed = 0;
      const worker = async () => {
        while (idx < texts.length) {
          const i = idx++;
          try {
            out[i] = await this._instance.translate(texts[i]);
            if (!out[i] || out[i] === texts[i]) failed++;
          } catch (e) {
            out[i] = texts[i];
            failed++;
          }
          done++;
          if (onProgress && (done % 5 === 0 || done === texts.length)) onProgress(done, texts.length);
        }
      };
      await Promise.all(Array.from({ length: CONC }, worker));
      // Si casi todo falló (modelo no descargado, par no soportado…), que caiga al siguiente backend
      if (texts.length >= 10 && failed / texts.length > 0.8) {
        this._instance = null;
        throw new Error(`Chrome Translator falló en ${failed}/${texts.length} cues`);
      }
      return out;
    },

    // Traduce UN lote de textos con el backend configurado (con fallback automático)
    async translateBatch(texts, src, tgt) {
      if (!texts.length) return texts;
      if (src === tgt) return texts;
      const pref = (this.settings && this.settings.translatorBackend) || 'auto';

      // Backend Ollama (LLM local del usuario)
      if (pref === 'ollama') {
        const memory = await this._relevantMemory(texts, tgt);
        const res = await chrome.runtime.sendMessage({
          type: 'DUBAI_OLLAMA_TRANSLATE',
          texts,
          src,
          tgt,
          url: (this.settings && this.settings.ollamaUrl) || 'http://localhost:11434',
          model: (this.settings && this.settings.ollamaModel) || 'llama3.1:8b',
          memory
        });
        if (!res || res.error) throw new Error((res && res.error) || 'Fallo de traducción con Ollama');
        const exact = new Map(
          memory.corrections.map((entry) => [String(entry.source).trim().toLocaleLowerCase(), entry.target])
        );
        return res.translations.map((text, i) => exact.get(String(texts[i]).trim().toLocaleLowerCase()) || text);
      }

      // Backend Chrome Translator (on-device), con fallback a offscreen si falla en esta sesión
      if (pref !== 'offscreen' && !this._nativeDead) {
        try {
          if (!this._instance || this._src !== src || this._tgt !== tgt) {
            const ok = await this._initNative(src, tgt);
            if (ok) {
              this._src = src;
              this._tgt = tgt;
            }
          }
          if (this._instance) return await this._translateNative(texts, null);
        } catch (e) {
          D.warn('Chrome Translator falló; se usa offscreen el resto de la sesión', e);
          this._instance = null;
          this._nativeDead = true;
        }
      }

      // Fallback: modelo local (NLLB/opus-mt) en el documento offscreen
      const res = await chrome.runtime.sendMessage({ type: 'DUBAI_TRANSLATE_OFFSCREEN', texts, src, tgt });
      if (!res || res.error) throw new Error((res && res.error) || 'Fallo de traducción offscreen');
      return res.translations;
    },

    // Compatibilidad (segmentos sueltos de Whisper, etc.)
    async translateAll(texts, src, tgt, onProgress) {
      const out = await this.translateBatch(texts, src, tgt);
      if (onProgress) onProgress(texts.length, texts.length);
      return out;
    }
  };

  D.translator = translator;
})(window.DubAI);
