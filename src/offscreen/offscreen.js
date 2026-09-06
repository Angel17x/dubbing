// DubAI — offscreen: modelos de IA locales con transformers.js
// - Traducción: NLLB-200 destilado (fallback cuando Chrome Translator no soporta el par)
// - Whisper: transcripción del audio de la pestaña para videos SIN subtítulos (experimental)
import * as tf from '../../lib/transformers.min.js';

'use strict';

tf.env.allowLocalModels = false;
tf.env.useBrowserCache = true;
// MV3 no permite workers blob: en el CSP → WASM mono-hilo y binarios servidos localmente
tf.env.backends.onnx.wasm.numThreads = 1;
tf.env.backends.onnx.wasm.proxy = false;
tf.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('lib/');

// ---------------- Traducción ----------------
const NLLB_CODES = {
  en: 'eng_Latn', es: 'spa_Latn', fr: 'fra_Latn', de: 'deu_Latn', it: 'ita_Latn',
  pt: 'por_Latn', ru: 'rus_Cyrl', zh: 'zho_Hans', ja: 'jpn_Jpan', ko: 'kor_Hang',
  ar: 'arb_Arab', hi: 'hin_Deva', nl: 'nld_Latn', pl: 'pol_Latn', tr: 'tur_Latn',
  vi: 'vie_Latn', id: 'ind_Latn', th: 'tha_Thai', uk: 'ukr_Cyrl', sv: 'swe_Latn'
};

// Pares con modelo opus-mt ligero y verificado; el resto usa NLLB
const OPUS = {
  'en>es': 'Xenova/opus-mt-en-es',
  'es>en': 'Xenova/opus-mt-es-en',
  'en>fr': 'Xenova/opus-mt-en-fr',
  'fr>en': 'Xenova/opus-mt-fr-en',
  'en>de': 'Xenova/opus-mt-en-de',
  'de>en': 'Xenova/opus-mt-de-en',
  'en>pt': 'Xenova/opus-mt-en-pt',
  'en>zh': 'Xenova/opus-mt-en-zh',
  'zh>en': 'Xenova/opus-mt-zh-en',
  'en>ru': 'Xenova/opus-mt-en-ru',
  'ru>en': 'Xenova/opus-mt-ru-en'
};

let translatorPipe = null;
let translatorKey = '';

async function getTranslator(src, tgt) {
  const key = `${src}>${tgt}`;
  if (translatorPipe && translatorKey === key) return translatorPipe;

  const opus = OPUS[key];
  if (opus) {
    translatorPipe = await tf.pipeline('translation', opus, { dtype: 'q8' });
  } else {
    const s = NLLB_CODES[src];
    const t = NLLB_CODES[tgt];
    if (!s || !t) throw new Error(`Par de idiomas no soportado por el modelo local: ${key}`);
    translatorPipe = await tf.pipeline('translation', 'Xenova/nllb-200-distilled-600M', { dtype: 'q8' });
    translatorPipe._nllb = { src_lang: s, tgt_lang: t };
  }
  translatorKey = key;
  return translatorPipe;
}

async function translateBatch(texts, src, tgt) {
  const pipe = await getTranslator(src, tgt);
  const out = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    try {
      const opts = pipe._nllb || {};
      const r = await pipe(texts[i], opts);
      out[i] = r && r[0] && r[0].translation_text ? r[0].translation_text : texts[i];
    } catch (e) {
      out[i] = texts[i];
    }
    if (i % 3 === 0 || i === texts.length - 1) {
      chrome.runtime.sendMessage({ type: 'DUBAI_PROGRESS_RELAY', done: i + 1, total: texts.length }).catch(() => {});
    }
  }
  return out;
}

// ---------------- Whisper (experimental) ----------------
let whisperPipe = null;
let whisperSession = null; // { ctx, stream, processor, tabId, lang }

const WHISPER_LANGS = {
  en: 'english', es: 'spanish', fr: 'french', de: 'german', it: 'italian', pt: 'portuguese',
  ru: 'russian', zh: 'chinese', ja: 'japanese', ko: 'korean', ar: 'arabic', hi: 'hindi',
  nl: 'dutch', pl: 'polish', tr: 'turkish', vi: 'vietnamese', id: 'indonesian', th: 'thai',
  uk: 'ukrainian', sv: 'swedish'
};

async function whisperStart({ streamId, lang, tabId }) {
  await whisperStop();

  if (!whisperPipe) {
    // WebGPU reduce drásticamente la demora frente al WASM mono-hilo exigido
    // por Manifest V3. Mantener WASM como respaldo para equipos incompatibles.
    if (navigator.gpu) {
      try {
        whisperPipe = await tf.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
          device: 'webgpu',
          dtype: 'fp16'
        });
      } catch (e) {
        console.warn('[DubAI offscreen] WebGPU no disponible para Whisper; usando WASM', e);
      }
    }
    if (!whisperPipe) {
      whisperPipe = await tf.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { dtype: 'q8' });
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });

  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  // La captura de pestaña silencia el audio local: lo re-enrutamos para que el usuario siga oyendo
  source.connect(ctx.destination);

  const processor = ctx.createScriptProcessor(4096, 1, 1);
  // Bloques menores entregan texto antes sin recortar tanto contexto como
  // para perjudicar frases rápidas.
  const CHUNK_SEC = 5;
  let buffer = [];
  let bufferedSec = 0;
  let busy = false;
  let chunkStart = 0;
  let lastStatusAt = 0;

  processor.onaudioprocess = (ev) => {
    const data = ev.inputBuffer.getChannelData(0);
    buffer.push(new Float32Array(data));
    bufferedSec += data.length / ctx.sampleRate;

    if (performance.now() - lastStatusAt > 1000) {
      lastStatusAt = performance.now();
      let energy = 0;
      for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
      const level = Math.sqrt(energy / Math.max(1, data.length));
      chrome.runtime
        .sendMessage({
          type: 'DUBAI_WHISPER_STATUS_RELAY',
          tabId,
          status: level > 0.001 ? `Whisper recibiendo audio… ${bufferedSec.toFixed(1)}/${CHUNK_SEC}s` : 'Whisper esperando audio…'
        })
        .catch(() => {});
    }

    if (bufferedSec >= CHUNK_SEC && !busy) {
      busy = true;
      const audio = concat(buffer);
      const start = chunkStart;
      buffer = [];
      bufferedSec = 0;
      chunkStart += CHUNK_SEC;
      chrome.runtime
        .sendMessage({ type: 'DUBAI_WHISPER_STATUS_RELAY', tabId, status: 'Whisper transcribiendo bloque…' })
        .catch(() => {});
      transcribeChunk(audio, ctx.sampleRate, start, lang, tabId).finally(() => {
        busy = false;
      });
    }
  };

  source.connect(processor);
  // Un ScriptProcessor desconectado de una salida no es procesado por Chrome.
  // Conectarlo a un gain silencioso mantiene el grafo activo sin duplicar audio.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  processor.connect(silent);
  silent.connect(ctx.destination);
  whisperSession = { ctx, stream, source, processor, silent, tabId, lang };
  return { ok: true };
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function resampleTo16k(input, sourceRate) {
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

async function transcribeChunk(audio, sampleRate, startSec, lang, tabId) {
  try {
    audio = resampleTo16k(audio, sampleRate);
    let energy = 0;
    for (let i = 0; i < audio.length; i++) energy += audio[i] * audio[i];
    const rms = Math.sqrt(energy / Math.max(1, audio.length));
    if (rms < 0.0012) {
      chrome.runtime
        .sendMessage({ type: 'DUBAI_WHISPER_STATUS_RELAY', tabId, status: 'Whisper esperando voz…' })
        .catch(() => {});
      return;
    }
    const opts = { chunk_length_s: 15, stride_length_s: 3, return_timestamps: false, task: 'transcribe' };
    if (lang && lang !== 'auto' && WHISPER_LANGS[lang]) opts.language = WHISPER_LANGS[lang];
    const r = await whisperPipe(audio, opts);
    const text = (r && r.text ? r.text : '').trim();
    if (text && text.length > 1) {
      chrome.runtime
        .sendMessage({
          type: 'DUBAI_WHISPER_SEGMENT_RELAY',
          tabId,
          segment: { start: startSec, text, lang: lang === 'auto' ? null : lang }
        })
        .catch(() => {});
    } else {
      chrome.runtime
        .sendMessage({ type: 'DUBAI_WHISPER_STATUS_RELAY', tabId, status: 'Whisper no detectó voz en este bloque…' })
        .catch(() => {});
    }
  } catch (e) {
    console.warn('[DubAI offscreen] whisper chunk error', e);
    chrome.runtime
      .sendMessage({
        type: 'DUBAI_WHISPER_STATUS_RELAY',
        tabId,
        status: 'Whisper falló al transcribir: ' + ((e && e.message) || e)
      })
      .catch(() => {});
  }
}

async function whisperStop() {
  if (!whisperSession) return { ok: true };
  try {
    whisperSession.source.disconnect();
    whisperSession.processor.disconnect();
    whisperSession.silent.disconnect();
    whisperSession.ctx.close();
    for (const t of whisperSession.stream.getTracks()) t.stop();
  } catch (e) {}
  whisperSession = null;
  return { ok: true };
}

// ---------------- Mensajes ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return; // solo mensajes dirigidos
  (async () => {
    try {
      switch (msg.type) {
        case 'TRANSLATE':
          sendResponse({ translations: await translateBatch(msg.texts, msg.src, msg.tgt) });
          break;
        case 'WHISPER_START':
          sendResponse(await whisperStart(msg));
          break;
        case 'WHISPER_STOP':
          sendResponse(await whisperStop());
          break;
        default:
          sendResponse({ error: 'tipo desconocido: ' + msg.type });
      }
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();
  return true;
});
