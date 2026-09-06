// DubAI — parsers de subtítulos: WebVTT y JSON3 de YouTube
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  function tsToSec(ts) {
    // 00:00:01.500 | 00:01.500
    const m = ts.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
    if (!m) return 0;
    const h = parseInt(m[1] || '0', 10);
    return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
  }

  function cleanText(t) {
    return t
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseVtt(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    for (const b of blocks) {
      const lines = b.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) continue;
      let i = 0;
      if (!lines[0].includes('-->')) {
        if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0])) continue;
        i = 1; // identificador de cue
      }
      if (i >= lines.length || !lines[i].includes('-->')) continue;
      const [a, b2] = lines[i].split('-->');
      const start = tsToSec(a);
      const end = tsToSec(b2.trim().split(/\s+/)[0]);
      const txt = cleanText(lines.slice(i + 1).join(' '));
      if (txt) cues.push({ start, end, text: txt });
    }
    return mergeShort(cues);
  }

  // Quita el solapamiento "rolling" típico de los subtítulos automáticos de YouTube
  function stripOverlap(prev, curr) {
    if (!prev) return curr;
    const pw = prev.split(' ');
    const cw = curr.split(' ');
    const max = Math.min(pw.length, cw.length);
    for (let n = max; n > 0; n--) {
      if (pw.slice(-n).join(' ') === cw.slice(0, n).join(' ')) {
        return cw.slice(n).join(' ');
      }
    }
    return curr;
  }

  function parseYoutubeJson3(json, isAsr) {
    const cues = [];
    let prevText = '';
    for (const ev of json.events || []) {
      if (!ev.segs) continue;
      let text = cleanText(ev.segs.map((s) => s.utf8).join('').replace(/\n/g, ' '));
      if (!text) continue;
      const start = (ev.tStartMs || 0) / 1000;
      const end = ((ev.tStartMs || 0) + (ev.dDurationMs || 0)) / 1000;
      if (isAsr) {
        text = stripOverlap(prevText, text);
        prevText = prevText ? prevText : text;
        if (!text) {
          // cue vacío: solo extiende el anterior
          if (cues.length) cues[cues.length - 1].end = Math.max(cues[cues.length - 1].end, end);
          continue;
        }
        prevText = text;
      }
      cues.push({ start, end, text });
    }
    return mergeShort(cues);
  }

  // Fusiona cues muy cortos para que el TTS suene natural (frases de ~2-8 s)
  function mergeShort(cues) {
    const out = [];
    for (const c of cues) {
      const last = out[out.length - 1];
      const dur = c.end - c.start;
      if (last && c.start - last.end < 0.6 && (dur < 1.2 || last.end - last.start < 1.2) && (last.text + ' ' + c.text).length < 220) {
        last.text = (last.text + ' ' + c.text).trim();
        last.end = Math.max(last.end, c.end);
      } else {
        out.push({ start: c.start, end: c.end, text: c.text });
      }
    }
    return out;
  }

  D.parsers = { parseVtt, parseYoutubeJson3, tsToSec };
})(window.DubAI);
