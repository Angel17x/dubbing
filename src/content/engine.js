// DubAI — motor de doblaje: sincroniza cues traducidos con el video (pause/seek/rate safe)
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  const engine = {
    state: 'idle', // idle | loading | ready | whisper | stopped | error
    video: null,
    cues: [],
    spoken: new Set(),
    translationDone: true,
    currentCue: null,
    _autoPaused: false,
    settings: null,
    timer: null,
    duckCount: 0,
    origVolume: 1,
    whisper: { active: false, epoch: 0, queue: Promise.resolve() },
    _bound: null,
    _resumeAfterBuffer: false,
    _initialBufferResolve: null,

    async toggle() {
      if (this.state === 'idle' || this.state === 'stopped' || this.state === 'error') return this.start();
      return this.stop();
    },

    async start() {
      try {
        this.state = 'loading';
        this.settings = await D.getSettings();
        D.translator.settings = this.settings;
        D.overlay.setActive(true);
        D.overlay.setStatus('Buscando video…');
        this.video = await D.waitForVideo();

        const extractor = D.subtitles[D.currentSite()] || D.subtitles.generic;
        D.overlay.setStatus('Extrayendo subtítulos…');
        let data = null;
        try {
          data = await extractor.getCues(this.settings);
        } catch (e) {
          D.warn('extractor falló', e);
        }

        if (!data || !data.cues || !data.cues.length) {
          // Muchos players solo cargan las pistas al reproducir: reintenta una vez al dar ▶
          let played = !this.video.paused && !this.video.ended;
          // Si ya estaba reproduciéndose, el player tuvo tiempo suficiente para
          // exponer pistas. Con Whisper habilitado no repetir otra espera larga.
          if (played && this.settings.whisperFallback) return this.startWhisper();
          if (!played) {
            D.overlay.setStatus('Sin subtítulos aún… pulsa ▶ en el video');
            played = await new Promise((resolve) => {
              let settled = false;
              const onPlaying = () => done(true);
              const done = (value) => {
                if (!settled) {
                  settled = true;
                  clearTimeout(timeout);
                  this.video.removeEventListener('playing', onPlaying);
                  resolve(value);
                }
              };
              const timeout = setTimeout(() => done(false), 20000);
              this.video.addEventListener('playing', onPlaying, { once: true });
            });
          }
          if (played && this.state === 'loading') {
            D.overlay.setStatus('Reintentando extracción de subtítulos…');
            await D.sleep(1500);
            try {
              data = await extractor.getCues(this.settings);
            } catch (e) {
              D.warn('reintento falló', e);
            }
          }
        }

        if (!data || !data.cues || !data.cues.length) {
          if (this.state !== 'loading') return; // se detuvo mientras esperaba
          if (this.settings.whisperFallback) return this.startWhisper();
          this.state = 'error';
          D.overlay.setStatus('Sin subtítulos detectados. Pulsa ▶ y reintenta, o usa Whisper:');
          D.overlay.showWhisperOption(true);
          return;
        }

        await this.prepareCues(data);
        if (this.state !== 'loading') return;
        this.attach();
        this.state = 'ready';
        if (this.translationDone) {
          D.overlay.setStatus('Doblaje listo ▶');
          D.overlay.setProgress(1);
        } else {
          D.overlay.setStatus('Traduciendo los primeros subtítulos…');
        }
        this.tick();
        if (this._resumeAfterBuffer && this.video && this.video.paused) {
          this._resumeAfterBuffer = false;
          this.video.play().catch(() => {});
        }
      } catch (e) {
        console.error('[DubAI]', e);
        this.state = 'error';
        D.overlay.setStatus('Error: ' + (e && e.message ? e.message : e));
      }
    },

    async prepareCues(data) {
      const { cues, lang, videoId } = data;
      const tgt = this.settings.targetLang;
      let src = this.settings.sourceLang;
      if (src === 'auto') {
        src = lang || (await D.translator.detect(cues.slice(0, 12).map((c) => c.text).join(' ')));
        // Ollama puede traducir sin conocer previamente el idioma. Los otros
        // backends requieren un código explícito y conservan inglés como fallback.
        if (!src) src = this.settings.translatorBackend === 'ollama' ? 'auto' : 'en';
      }
      D.log(`idioma origen: ${src} → ${tgt}, ${cues.length} cues`);

      this.cues = cues.map((c, i) => ({ ...c, i, es: null }));
      // Si DubAI se activa a mitad del video, no intentar hablar ni esperar
      // traducciones de frases que ya quedaron atrás.
      const now = this.video ? this.video.currentTime : 0;
      this.spoken = new Set(this.cues.filter((c) => c.end < now - 0.1).map((c) => c.i));

      // La caché depende del motor/modelo: evita reutilizar traducciones antiguas
      // o texto original guardado por una versión previa.
      const backend = this.settings.translatorBackend || 'auto';
      const model = backend === 'ollama' ? this.settings.ollamaModel || 'llama3.1:8b' : '';
      let memoryRevision = 0;
      if (backend === 'ollama') {
        try {
          const storedMemory = await chrome.storage.local.get('dubaiTranslationMemoryV1');
          memoryRevision = (storedMemory.dubaiTranslationMemoryV1 || {}).updatedAt || 0;
        } catch (e) {}
      }
      const cacheKey = `dubai:v6:${location.hostname}:${videoId}:${src}:${tgt}:${backend}:${model}:${memoryRevision}`;
      let cached = null;
      try {
        const c = await chrome.storage.local.get(cacheKey);
        cached = c[cacheKey];
      } catch (e) {}

      if (cached && cached.length === cues.length) {
        this.cues.forEach((c, i) => {
          c.es = cached[i] || c.text;
        });
        const upcoming = this.cues.filter((c) => !this.spoken.has(c.i)).slice(0, 3);
        this.prefetchVoices(upcoming);
        this.translationDone = true;
        D.overlay.setStatus('Traducción desde caché ✔');
        D.overlay.setProgress(1);
        return;
      }

      // Traducción PROGRESIVA: el doblaje empieza con los primeros lotes,
      // pero prepara un pequeño búfer antes de continuar la reproducción.
      this.translationDone = false;
      this._resumeAfterBuffer = !!(this.video && !this.video.paused);
      if (this._resumeAfterBuffer) this.video.pause();
      const initialBufferReady = new Promise((resolve) => {
        this._initialBufferResolve = resolve;
      });
      this.translationPromise = this.translateLoop(src, tgt, cacheKey);
      D.overlay.setStatus('Preparando traducción y voz inicial…');
      await Promise.race([initialBufferReady, D.sleep(45000)]);
      this._initialBufferResolve = null;
    },

    async translateLoop(src, tgt, cacheKey) {
      const cues = this.cues; // referencia local: si se navega y se reemplaza, abortar
      const total = cues.length;
      let done = 0;
      const now = this.video ? this.video.currentTime : 0;
      let start = cues.findIndex((c) => c.end >= now - 0.2);
      if (start < 0) start = 0;
      // Prioridad: posición actual → final. Al terminar, completar el tramo
      // anterior para dejar la caché completa.
      const order = [];
      for (let i = start; i < total; i++) order.push(i);
      for (let i = 0; i < start; i++) order.push(i);
      try {
        for (let pos = 0; pos < total; ) {
          if (this.state === 'stopped' || this.state === 'idle' || this.cues !== cues) return;
          // Seis frases permiten arrancar pronto. Después, lotes mayores
          // aprovechan mejor Ollama y mantienen traducción por delante del video.
          const size = pos === 0 ? 6 : 12;
          const indices = order.slice(pos, pos + size);
          const batch = indices.map((i) => cues[i]);
          D.overlay.setStatus(
            pos === 0
              ? `Traduciendo las próximas ${batch.length} frases…`
              : `Traduciendo ${done}/${total}`
          );
          const tr = await D.translator.translateBatch(
            batch.map((c) => c.text),
            src,
            tgt
          );
          if (this.cues !== cues) return; // navegación a mitad de lote
          batch.forEach((c, k) => {
            c.es = tr[k] || c.text;
          });
          const voicesReady = this.prefetchVoices(batch.slice(0, pos === 0 ? 2 : 3));
          done += batch.length;
          pos += batch.length;
          if (pos === batch.length && this._initialBufferResolve) {
            // Con XTTS, esperar también a que las primeras voces estén listas.
            await Promise.race([voicesReady, D.sleep(30000)]);
            if (this._initialBufferResolve) this._initialBufferResolve();
          }
          D.overlay.setStatus(`Traduciendo ${Math.min(done, total)}/${total} · ya puedes dar ▶`);
          D.overlay.setProgress(done / total);
        }
        this.translationDone = true;
        D.overlay.setStatus('Traducción completa ✔');
        try {
          await chrome.storage.local.set({ [cacheKey]: cues.map((c) => c.es) });
        } catch (e) {}
      } catch (e) {
        if (this.cues !== cues) return; // error de un video anterior: ignorar
        if (this._initialBufferResolve) this._initialBufferResolve();
        D.warn('translateLoop error', e);
        D.overlay.setStatus('Error de traducción: ' + ((e && e.message) || e));
        // Rellenar con el original lo que falte para no quedar mudo
        for (const c of cues) if (!c.es) c.es = c.text;
        this.translationDone = true;
      }
    },

    prefetchVoices(cues) {
      if (!this.settings || this.settings.voiceBackend !== 'xtts') return Promise.resolve();
      const tasks = [];
      for (const cue of cues) {
        if (!cue || !cue.es) continue;
        tasks.push(D.tts.prefetch(cue.es, {
          lang: this.settings.targetLang,
          backend: 'xtts',
          xttsUrl: this.settings.xttsUrl,
          xttsReference: this.settings.xttsReference
        }));
      }
      return Promise.all(tasks);
    },

    attach() {
      const v = this.video;
      this._bound = {
        pause: () => this.onPause(),
        seeked: () => this.onSeek(),
        ratechange: () => {},
        ended: () => this.onPause()
      };
      for (const [ev, fn] of Object.entries(this._bound)) v.addEventListener(ev, fn);
      this.timer = setInterval(() => this.tick(), 200);
    },

    detach() {
      if (this.video && this._bound) {
        for (const [ev, fn] of Object.entries(this._bound)) this.video.removeEventListener(ev, fn);
      }
      this._bound = null;
      clearInterval(this.timer);
      this.timer = null;
    },

    tick() {
      if (this.state !== 'ready' || !this.video) return;
      const v = this.video;
      const t = v.currentTime;

      // Estábamos en pausa automática (esperando traducción): reanudar cuando llegue
      if (this._autoPaused) {
        const next = this.cues.find((c) => !this.spoken.has(c.i));
        const ready = !next || !!next.es || this.translationDone;
        if (ready) {
          this._autoPaused = false;
          D.overlay.setCaption('');
          if (v.paused) v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause(); // el usuario le dio a play pero aún no llega la traducción
        }
        return;
      }

      // Subtítulo traducido en pantalla ('…' si aún no llega su traducción)
      const active = this.cues.find((c) => t >= c.start && t < c.end);
      D.overlay.setCaption(this.settings.showSubs && active ? active.es || '…' : '', active && active.es ? active.text : '');

      // No iniciar otra frase mientras el TTS sigue hablando. Si la voz no
      // cabe en su intervalo a una velocidad comprensible, congelar brevemente
      // el video hasta que termine.
      if (this.currentCue) {
        if (!v.paused && t >= this.currentCue.end - 0.12 && D.tts.isBusy()) {
          this._speechHold = true;
          v.pause();
        }
        return;
      }

      if (v.paused) return;

      // Si el siguiente cue aún no está traducido, pausar el video para MANTENER LA SINCRONÍA
      // (nunca saltarse frases: mejor una micro-pausa que perder contenido)
      const nextDue = this.cues.find((c) => !this.spoken.has(c.i) && t >= c.start - 0.08);
      if (nextDue && !nextDue.es && !this.translationDone) {
        v.pause();
        this._autoPaused = true;
        D.overlay.setCaption('⏳ traduciendo…');
        return;
      }

      const due = this.cues.find((c) => !this.spoken.has(c.i) && c.es && t >= c.start - 0.08 && t < Math.max(c.end, c.start + 0.3));
      if (due) {
        this.spoken.add(due.i);
        this.speakCue(due);
      }
    },

    speakCue(cue) {
      const dur = Math.max(0.5, cue.end - cue.start);
      // Mantener una velocidad inteligible. Las frases demasiado largas
      // provocarán una micro-pausa del video en tick(), no una voz acelerada.
      let rate = D.clamp(cue.es.length / 15 / dur, 0.9, 1.25) * (this.settings.rate || 1);
      rate = D.clamp(rate, 0.75, 1.35);
      this.currentCue = cue; // bloquear la cola antes de que onstart se dispare
      D.tts.speak(cue.es, {
        rate,
        lang: this.settings.targetLang,
        voiceURI: this.settings.voiceURI,
        backend: this.settings.voiceBackend,
        xttsUrl: this.settings.xttsUrl,
        xttsReference: this.settings.xttsReference,
        onstart: () => {
          this.duck(true);
        },
        onend: () => {
          if (this.currentCue === cue) this.currentCue = null;
          this.duck(false);
          if (this._speechHold) {
            this._speechHold = false;
            if (this.video && this.video.paused && this.state === 'ready') {
              this.video.play().catch(() => {});
            }
          }
        }
      });
      this.prefetchVoices(this.cues.slice(cue.i + 1, cue.i + 9));
    },

    duck(on) {
      if (!this.settings || !this.settings.duck || !this.video) return;
      if (on) {
        if (this.duckCount++ === 0) {
          this.origVolume = this.video.volume;
          this.video.volume = D.clamp(this.origVolume * this.settings.duckLevel, 0, 1);
        }
      } else if (--this.duckCount <= 0) {
        this.duckCount = 0;
        try {
          this.video.volume = this.origVolume;
        } catch (e) {}
      }
    },

    onPause() {
      // Pausa interna para dejar terminar una frase larga: no cancelar el TTS.
      if (this._speechHold) return;
      if (this.state === 'whisper') {
        this.whisper.epoch++;
        D.overlay.setStatus('Whisper pausado con el video');
      }
      D.tts.cancel();
      this.restoreVolume();
      // Al reanudar, repetir el cue que quedó a medias
      if (this.currentCue) {
        this.spoken.delete(this.currentCue.i);
        this.currentCue = null;
      }
    },

    onSeek() {
      this._speechHold = false;
      D.tts.cancel();
      this.currentCue = null;
      this.restoreVolume();
      const t = this.video.currentTime;
      this.spoken = new Set(this.cues.filter((c) => c.end < t).map((c) => c.i));
    },

    restoreVolume() {
      if (this.video && this.duckCount > 0) {
        try {
          this.video.volume = this.origVolume;
        } catch (e) {}
      }
      this.duckCount = 0;
    },

    // ---------- Modo Whisper (videos sin subtítulos, experimental) ----------
    async enableWhisperAndStart() {
      D.overlay.showWhisperOption(false);
      this.settings = await D.getSettings();
      this.settings.whisperFallback = true;
      D.translator.settings = this.settings;
      if (!this.video) {
        try {
          this.video = await D.waitForVideo();
        } catch (e) {}
      }
      this.state = 'loading';
      D.overlay.setActive(true);
      return this.startWhisper();
    },

    async startWhisper() {
      this.state = 'whisper';
      this.whisper.active = true;
      this.whisper.epoch++;
      this.whisper.queue = Promise.resolve();
      D.overlay.setStatus('Iniciando Whisper local (la 1ª vez descarga el modelo)…');
      const res = await chrome.runtime.sendMessage({ type: 'DUBAI_WHISPER_START', lang: this.settings.sourceLang });
      if (!res || res.error) {
        this.state = 'error';
        this.whisper.active = false;
        D.overlay.setStatus('Whisper falló: ' + ((res && res.error) || 'desconocido'));
        return;
      }
      this.attachWhisper();
      D.overlay.setStatus('Whisper escuchando y doblando…');
    },

    attachWhisper() {
      const v = this.video;
      this._bound = {
        pause: () => this.onPause(),
        play: () => D.overlay.setStatus('Whisper escuchando y doblando…'),
        ended: () => this.onPause()
      };
      for (const [ev, fn] of Object.entries(this._bound)) v.addEventListener(ev, fn);
    },

    onWhisperSegment(seg) {
      if (!this.whisper.active || !seg || !seg.text || !this.video || this.video.paused) return;
      const epoch = this.whisper.epoch;
      // Mantener una sola voz y una sola traducción a la vez. Así las personas
      // que hablan rápido no pisan el audio del segmento anterior.
      this.whisper.queue = this.whisper.queue
        .catch(() => {})
        .then(() => this.processWhisperSegment(seg, epoch));
    },

    async processWhisperSegment(seg, epoch) {
      const valid = () =>
        this.whisper.active && this.whisper.epoch === epoch && this.video && !this.video.paused && this.state === 'whisper';
      if (!valid()) return;
      const tgt = this.settings.targetLang;
      let text = seg.text;
      let src = seg.lang || this.settings.sourceLang || 'auto';
      if (src === 'auto' && this.settings.translatorBackend !== 'ollama') {
        src = (await D.translator.detect(seg.text)) || 'en';
      }
      if (src !== tgt) {
        try {
          D.overlay.setStatus('Whisper traduciendo segmento…');
          [text] = await D.translator.translateAll([seg.text], src, tgt);
        } catch (e) {
          D.warn('No se pudo traducir segmento Whisper', e);
        }
      }
      // La traducción puede terminar después de que el usuario haya pausado.
      // En ese caso se descarta para que nunca hable sobre el video detenido.
      if (!valid() || !text) return;
      D.overlay.setCaption(this.settings.showSubs ? text : '', seg.text);
      await new Promise((resolve) => {
        D.tts.speak(text, {
          rate: D.clamp((this.settings.rate || 1) * 1.08, 0.75, 1.25),
          lang: tgt,
          voiceURI: this.settings.voiceURI,
          backend: this.settings.voiceBackend,
          xttsUrl: this.settings.xttsUrl,
          xttsReference: this.settings.xttsReference,
          onstart: () => this.duck(true),
          onend: () => {
            this.duck(false);
            resolve();
          }
        });
      });
    },

    async saveCorrection(source, target) {
      source = String(source || '').trim();
      target = String(target || '').trim();
      if (!source || !target) return;
      const key = 'dubaiTranslationMemoryV1';
      const stored = await chrome.storage.local.get(key);
      const memory = stored[key] || { glossary: [], corrections: [] };
      const corrections = Array.isArray(memory.corrections) ? memory.corrections : [];
      const src = (this.settings && this.settings.sourceLang) || 'auto';
      const tgt = (this.settings && this.settings.targetLang) || 'es';
      const normalized = source.toLocaleLowerCase();
      const existing = corrections.find(
        (item) => item && item.source && item.source.toLocaleLowerCase() === normalized && item.tgt === tgt
      );
      if (existing) {
        existing.target = target;
        existing.updatedAt = Date.now();
        existing.uses = (existing.uses || 0) + 1;
      } else {
        corrections.push({
          source,
          target,
          src,
          tgt,
          site: location.hostname,
          uses: 1,
          updatedAt: Date.now()
        });
      }
      corrections.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      await chrome.storage.local.set({
        [key]: {
          glossary: memory.glossary || [],
          corrections: corrections.slice(0, 300),
          updatedAt: Date.now()
        }
      });
      for (const cue of this.cues) {
        if (cue.text && cue.text.toLocaleLowerCase() === normalized) cue.es = target;
      }
      D.overlay.setCaption(target, source);
      D.overlay.setStatus('Corrección aprendida localmente ✔');
    },

    onSettings(s) {
      this.settings = Object.assign({}, this.settings, s);
      D.translator.settings = this.settings;
      if (!s.showSubs) D.overlay.setCaption('');
    },

    async stop() {
      this.state = 'stopped';
      this._autoPaused = false;
      this._resumeAfterBuffer = false;
      if (this._initialBufferResolve) this._initialBufferResolve();
      this._initialBufferResolve = null;
      this.detach();
      D.tts.cancel();
      D.tts.clearPrefetch();
      this.currentCue = null;
      this.restoreVolume();
      if (this.whisper.active) {
        this.whisper.active = false;
        try {
          await chrome.runtime.sendMessage({ type: 'DUBAI_WHISPER_STOP' });
        } catch (e) {}
      }
      this.cues = [];
      this.spoken = new Set();
      this.translationDone = true;
      D.overlay.setCaption('');
      D.overlay.setStatus('');
      D.overlay.setProgress(0);
      D.overlay.setActive(false);
      D.overlay.showWhisperOption(false);
    }
  };

  D.engine = engine;
})(window.DubAI);
