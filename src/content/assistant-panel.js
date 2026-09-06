// DubAI — panel lateral de resumen y preguntas sobre el video
window.DubAI = window.DubAI || {};
(function (D) {
  'use strict';

  let root;
  let panel;
  let summaryView;
  let chatView;
  let summaryOutput;
  let summaryStatus;
  let messagesBox;
  let questionInput;
  let askButton;
  let currentRecord = null;
  let busy = false;

  function create() {
    if (document.getElementById('dubai-assistant-root')) return;
    root = document.createElement('div');
    root.id = 'dubai-assistant-root';
    root.innerHTML = `
      <aside id="dubai-assistant-panel" aria-label="Asistente del video">
        <header class="dubai-assistant-header">
          <div><strong>Asistente DubAI</strong><small>Resumen y preguntas locales</small></div>
          <button id="dubai-assistant-close" title="Cerrar">×</button>
        </header>
        <nav class="dubai-assistant-tabs">
          <button data-view="summary" class="active">Resumen</button>
          <button data-view="chat">Preguntar</button>
        </nav>
        <section id="dubai-summary-view" class="dubai-assistant-view active">
          <button id="dubai-generate-summary" class="dubai-assistant-primary">Generar resumen</button>
          <div id="dubai-summary-status" class="dubai-assistant-status"></div>
          <div id="dubai-summary-output" class="dubai-rich-text"></div>
        </section>
        <section id="dubai-chat-view" class="dubai-assistant-view">
          <div id="dubai-chat-messages"></div>
          <form id="dubai-chat-form">
            <textarea id="dubai-chat-question" rows="3" placeholder="Pregunta algo sobre este video…"></textarea>
            <div class="dubai-chat-actions">
              <button id="dubai-clear-chat" type="button">Limpiar</button>
              <button id="dubai-chat-send" class="dubai-assistant-primary" type="submit">Preguntar</button>
            </div>
          </form>
        </section>
      </aside>`;
    document.documentElement.appendChild(root);

    panel = root.querySelector('#dubai-assistant-panel');
    summaryView = root.querySelector('#dubai-summary-view');
    chatView = root.querySelector('#dubai-chat-view');
    summaryOutput = root.querySelector('#dubai-summary-output');
    summaryStatus = root.querySelector('#dubai-summary-status');
    messagesBox = root.querySelector('#dubai-chat-messages');
    questionInput = root.querySelector('#dubai-chat-question');
    askButton = root.querySelector('#dubai-chat-send');

    root.querySelector('#dubai-assistant-close').addEventListener('click', () => close());
    for (const tab of root.querySelectorAll('.dubai-assistant-tabs button')) {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    }
    root.querySelector('#dubai-generate-summary').addEventListener('click', () => generateSummary(false));
    root.querySelector('#dubai-chat-form').addEventListener('submit', (event) => {
      event.preventDefault();
      ask(questionInput.value);
    });
    questionInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        ask(questionInput.value);
      }
    });
    root.querySelector('#dubai-clear-chat').addEventListener('click', clearChat);
  }

  function switchView(view) {
    const summary = view !== 'chat';
    summaryView.classList.toggle('active', summary);
    chatView.classList.toggle('active', !summary);
    for (const tab of root.querySelectorAll('.dubai-assistant-tabs button')) {
      tab.classList.toggle('active', tab.dataset.view === (summary ? 'summary' : 'chat'));
    }
    if (!summary) setTimeout(() => questionInput.focus(), 0);
  }

  function seek(seconds) {
    const video = (D.engine && D.engine.video) || document.querySelector('video');
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(seconds, Number(video.duration) || seconds));
    video.play().catch(() => {});
  }

  function appendRichText(container, text) {
    container.textContent = '';
    const value = String(text || '');
    const pattern = /\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(value))) {
      if (match.index > last) container.appendChild(document.createTextNode(value.slice(last, match.index)));
      const button = document.createElement('button');
      button.className = 'dubai-timestamp';
      button.textContent = match[0].replace(/^\[|\]$/g, '');
      const seconds = match[3]
        ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
        : Number(match[1]) * 60 + Number(match[2]);
      button.addEventListener('click', () => seek(seconds));
      container.appendChild(button);
      last = pattern.lastIndex;
    }
    if (last < value.length) container.appendChild(document.createTextNode(value.slice(last)));
  }

  async function ensureRecord() {
    if (
      D.engine &&
      D.engine.video &&
      D.engine.videoMeta &&
      D.engine.videoMeta.mediaKey === D.mediaKey()
    ) {
      await D.videoKnowledge.captureEngine(D.engine);
    }
    currentRecord = await D.videoKnowledge.load(D.mediaKey());
    return currentRecord;
  }

  function renderMessages() {
    messagesBox.textContent = '';
    const messages = (currentRecord && currentRecord.messages) || [];
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'dubai-assistant-empty';
      empty.textContent = 'Haz una pregunta sobre la explicación, comandos o conceptos del video.';
      messagesBox.appendChild(empty);
      return;
    }
    for (const message of messages) {
      const bubble = document.createElement('div');
      bubble.className = `dubai-chat-message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
      appendRichText(bubble, message.content);
      messagesBox.appendChild(bubble);
    }
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  async function loadCurrent() {
    summaryStatus.textContent = 'Cargando transcripción…';
    const record = await ensureRecord();
    if (!record || !record.chunks || !record.chunks.length) {
      summaryStatus.textContent = 'Activa DubAI para obtener la transcripción de este video.';
      summaryOutput.textContent = '';
      currentRecord = null;
    } else {
      summaryStatus.textContent = `${record.cues.length} fragmentos disponibles`;
      appendRichText(summaryOutput, record.summary || '');
    }
    renderMessages();
  }

  async function open(view = 'summary') {
    create();
    panel.classList.add('open');
    if (D.playerButton) D.playerButton.setAssistantActive(true);
    switchView(view);
    await loadCurrent();
  }

  function close() {
    if (panel) panel.classList.remove('open');
    if (D.playerButton) D.playerButton.setAssistantActive(false);
  }

  function toggle() {
    create();
    if (panel.classList.contains('open')) close();
    else open('summary');
  }

  async function generateSummary(silent = false) {
    if (busy) return;
    create();
    if (!silent) {
      panel.classList.add('open');
      switchView('summary');
      if (D.playerButton) D.playerButton.setAssistantActive(true);
    }
    const record = await ensureRecord();
    if (!record || !record.chunks || !record.chunks.length) {
      summaryStatus.textContent = 'No hay transcripción disponible.';
      return;
    }
    if (record.summary) {
      appendRichText(summaryOutput, record.summary);
      summaryStatus.textContent = 'Resumen guardado localmente';
      return record.summary;
    }
    busy = true;
    summaryStatus.textContent = 'Preparando resumen…';
    try {
      const settings = await D.getSettings();
      const response = await chrome.runtime.sendMessage({
        type: 'DUBAI_OLLAMA_SUMMARIZE',
        chunks: record.chunks,
        url: settings.ollamaUrl,
        model: settings.ollamaModel
      });
      if (!response || response.error || !response.summary) {
        throw new Error((response && response.error) || 'Ollama no devolvió un resumen');
      }
      record.summary = response.summary;
      currentRecord = await D.videoKnowledge.update(record.mediaKey, { summary: response.summary });
      appendRichText(summaryOutput, response.summary);
      summaryStatus.textContent = 'Resumen generado y guardado ✔';
      return response.summary;
    } catch (error) {
      summaryStatus.textContent = 'No se pudo generar: ' + ((error && error.message) || error);
    } finally {
      busy = false;
    }
  }

  async function ask(rawQuestion) {
    const question = String(rawQuestion || '').trim();
    if (!question || busy) return;
    const record = await ensureRecord();
    if (!record || !record.chunks || !record.chunks.length) {
      summaryStatus.textContent = 'No hay transcripción disponible.';
      return;
    }
    busy = true;
    askButton.disabled = true;
    questionInput.value = '';
    const messages = (record.messages || []).slice(-49);
    const history = messages.slice(-6);
    messages.push({ role: 'user', content: question, at: Date.now() });
    currentRecord = await D.videoKnowledge.update(record.mediaKey, { messages });
    renderMessages();
    try {
      const settings = await D.getSettings();
      const context = D.videoKnowledge.selectRelevant(record, question, D.engine.video ? D.engine.video.currentTime : 0);
      const response = await chrome.runtime.sendMessage({
        type: 'DUBAI_OLLAMA_ASK',
        question,
        context,
        history,
        url: settings.ollamaUrl,
        model: settings.ollamaModel
      });
      if (!response || response.error || !response.answer) {
        throw new Error((response && response.error) || 'Ollama no devolvió una respuesta');
      }
      messages.push({ role: 'assistant', content: response.answer, at: Date.now() });
    } catch (error) {
      messages.push({ role: 'assistant', content: 'No pude responder: ' + ((error && error.message) || error), at: Date.now() });
    } finally {
      currentRecord = await D.videoKnowledge.update(record.mediaKey, { messages });
      renderMessages();
      busy = false;
      askButton.disabled = false;
      questionInput.focus();
    }
  }

  async function clearChat() {
    const record = await ensureRecord();
    if (!record) return;
    currentRecord = await D.videoKnowledge.update(record.mediaKey, { messages: [] });
    renderMessages();
  }

  function setProgress(status) {
    create();
    summaryStatus.textContent = status || '';
  }

  function resetForVideo() {
    currentRecord = null;
    if (summaryOutput) summaryOutput.textContent = '';
    if (messagesBox) messagesBox.textContent = '';
    if (panel && panel.classList.contains('open')) loadCurrent();
  }

  function refresh() {
    if (!busy && panel && panel.classList.contains('open')) loadCurrent();
  }

  D.assistantPanel = {
    create,
    open,
    close,
    toggle,
    generateSummary,
    setProgress,
    resetForVideo,
    refresh
  };
})(window.DubAI);
