// DubAI — TTS local con speechSynthesis (voces del sistema / Google del navegador)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  const tts = {
    voices: [],
    audio: null,
    audioUrl: null,
    loading: false,
    token: 0,
    finish: null,
    cache: new Map(),
    inflight: new Map(),

    init() {
      const load = () => {
        this.voices = speechSynthesis.getVoices() || [];
      };
      load();
      speechSynthesis.onvoiceschanged = load;
      // Workaround del bug de Chrome que corta locuciones largas con voces de red
      setInterval(() => {
        try {
          if (speechSynthesis.speaking && !speechSynthesis.paused) speechSynthesis.resume();
        } catch (e) {}
      }, 8000);
    },

    pick(lang, uri) {
      if (uri) {
        const v = this.voices.find((v) => v.voiceURI === uri);
        if (v) return v;
      }
      const pref = this.voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(String(lang).toLowerCase()));
      return (
        pref.find((v) => /google/i.test(v.name)) ||
        pref.find((v) => /natural|neural|online/i.test(v.name)) ||
        pref[0] ||
        null
      );
    },

    speak(
      text,
      {
        rate = 1,
        lang = 'es',
        voiceURI = '',
        backend = 'system',
        xttsUrl = 'http://127.0.0.1:8020',
        xttsReference = '',
        onstart,
        onend
      } = {}
    ) {
      if (!text || !text.trim()) {
        if (onend) onend();
        return;
      }
      if (backend === 'xtts') {
        this._speakXtts(text, { rate, lang, xttsUrl, xttsReference, onstart, onend });
        return;
      }

      const u = new SpeechSynthesisUtterance(text);
      const v = this.pick(lang, voiceURI);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else {
        u.lang = lang;
      }
      u.rate = D.clamp(rate, 0.5, 3);
      u.volume = 1;

      let started = false;
      let ended = false;
      const done = () => {
        if (!ended) {
          ended = true;
          if (this.finish === done) this.finish = null;
          if (onend) onend();
        }
      };
      this.finish = done;
      u.onstart = () => {
        started = true;
        if (onstart) onstart();
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
      // Seguridad: si el utterance nunca arrancó (cola vacía colgada), liberar
      setTimeout(() => {
        if (!started && !speechSynthesis.speaking && !speechSynthesis.pending) done();
      }, 4000);
    },

    _xttsKey(text, lang, xttsReference) {
      return `${lang}|${xttsReference}|${text}`;
    },

    async _getXttsAudio(text, lang, xttsUrl, xttsReference) {
      const key = this._xttsKey(text, lang, xttsReference);
      if (this.cache.has(key)) return this.cache.get(key);
      if (this.inflight.has(key)) return this.inflight.get(key);

      const request = chrome.runtime
        .sendMessage({
          type: 'DUBAI_XTTS_SYNTHESIZE',
          url: xttsUrl,
          text,
          language: lang,
          reference: xttsReference
        })
        .then((res) => {
          if (!res || res.error || !res.audioBase64) {
            throw new Error((res && res.error) || 'XTTS no devolvió audio');
          }
          this.cache.set(key, res);
          // Límite aproximado de memoria: conservar las últimas 30 frases.
          while (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
          return res;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, request);
      return request;
    },

    prefetch(text, { lang = 'es', backend = 'system', xttsUrl, xttsReference } = {}) {
      if (backend !== 'xtts' || !text) return;
      // XTTS procesa una síntesis por vez. No inundar el service worker y el
      // servidor cuando una traducción completa llega desde caché.
      if (this.inflight.size >= 2) return;
      this._getXttsAudio(text, lang, xttsUrl, xttsReference).catch((e) => D.warn('XTTS prefetch falló', e));
    },

    async _speakXtts(text, { rate, lang, xttsUrl, xttsReference, onstart, onend }) {
      const myToken = ++this.token;
      this.loading = true;
      let ended = false;
      const done = () => {
        if (ended) return;
        ended = true;
        this.loading = false;
        if (this.finish === done) this.finish = null;
        if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;
        this.audio = null;
        if (onend) onend();
      };
      this.finish = done;

      try {
        const res = await this._getXttsAudio(text, lang, xttsUrl, xttsReference);
        if (myToken !== this.token) return;

        const binary = atob(res.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: res.contentType || 'audio/wav' });
        this.audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(this.audioUrl);
        this.audio = audio;
        audio.playbackRate = D.clamp(rate, 0.8, 1.2);
        audio.onended = done;
        audio.onerror = done;
        this.loading = false;
        if (onstart) onstart();
        await audio.play();
      } catch (e) {
        D.warn('XTTS falló', e);
        done();
      }
    },

    isBusy() {
      return this.loading || !!(this.audio && !this.audio.ended) || speechSynthesis.speaking || speechSynthesis.pending;
    },

    cancel() {
      this.token++;
      this.loading = false;
      const finish = this.finish;
      this.finish = null;
      if (this.audio) {
        try {
          this.audio.pause();
          this.audio.currentTime = 0;
        } catch (e) {}
      }
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audio = null;
      this.audioUrl = null;
      try {
        speechSynthesis.cancel();
      } catch (e) {}
      // Libera también cualquier cola que esté esperando el final de la voz.
      if (finish) finish();
    }
  };

  D.tts = tts;
})(window.DubAI);
