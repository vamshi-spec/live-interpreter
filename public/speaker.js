// Speaker console: capture mic -> 16 kHz PCM -> WebSocket -> server pipeline.
let ws = null;
let audioCtx = null;
let workletNode = null;
let micStream = null;
let langs = [];

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  const r = await fetch('/api/config');
  const cfg = await r.json();
  langs = cfg.languages || [];
}

function fmtUptime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderCounts(byLang, total) {
  $('totalListeners').textContent = total;
  const grid = $('counts');
  grid.innerHTML = '';
  for (const l of langs) {
    const n = (byLang && byLang[l.code]) || 0;
    const card = document.createElement('div');
    card.className = 'count-card';
    card.innerHTML = `<div class="lang">${l.native} · ${l.name}</div><div class="n">${n}</div>`;
    grid.appendChild(card);
  }
}

function renderTranscript({ final, partial }) {
  const el = $('transcript');
  if (!final && !partial) { el.innerHTML = '<span class="partial">Waiting for you to speak…</span>'; return; }
  el.innerHTML = `${final ? escapeHtml(final) + ' ' : ''}<span class="partial">${escapeHtml(partial || '')}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.audioWorklet.addModule('/pcm-worklet.js');
  const src = audioCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtx, 'pcm-downsampler');
  workletNode.port.onmessage = (e) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data); // ArrayBuffer of Int16 PCM @ 16 kHz
  };
  src.connect(workletNode);
  // Worklet must be connected to the graph to pull audio; route to a muted gain.
  const sink = audioCtx.createGain();
  sink.gain.value = 0;
  workletNode.connect(sink).connect(audioCtx.destination);
}

function openWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/speaker`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'transcript') renderTranscript(msg);
    else if (msg.type === 'status') {
      renderCounts(msg.byLanguage, msg.totalListeners);
      $('uptimePill').textContent = fmtUptime(msg.uptimeSec || 0);
      if (msg.transcript) renderTranscript(msg.transcript);
    } else if (msg.type === 'error') {
      $('startError').textContent = msg.error;
    }
  };
  ws.onclose = () => { $('liveDot').classList.remove('live'); $('liveLabel').textContent = 'DISCONNECTED'; };
}

async function start() {
  $('startError').textContent = '';
  $('startBtn').disabled = true;
  try {
    const mode = $('directMode').checked ? 'direct' : 'cascade';
    const r = await fetch('/api/session/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to start');

    $('qr').src = data.qrDataUrl;
    $('shareLink').textContent = data.listenUrl;
    $('modePill').textContent = data.mode;
    $('startPanel').style.display = 'none';
    $('livePanel').style.display = 'block';
    $('statsPanel').style.display = 'block';
    $('transcriptPanel').style.display = 'block';

    await startMic();
    openWs();
  } catch (e) {
    $('startError').textContent = e.message;
    $('startBtn').disabled = false;
  }
}

async function stop() {
  try { ws?.send(JSON.stringify({ type: 'pause' })); } catch {}
  try { workletNode?.disconnect(); } catch {}
  try { micStream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { await audioCtx?.close(); } catch {}
  try { ws?.close(); } catch {}
  await fetch('/api/session/stop', { method: 'POST' });
  location.reload();
}

$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);
$('copyBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('shareLink').textContent);
  $('copyMsg').textContent = 'Copied!';
  setTimeout(() => ($('copyMsg').textContent = ''), 1500);
});

loadConfig();
