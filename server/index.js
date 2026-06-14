import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { config } from './config.js';
import { BroadcastSession } from './pipeline.js';
import { createListenerToken } from './livekit/tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Phase 1: a single live session at a time.
let session = null;

// ── Public config for the client (NO secrets — only the LiveKit ws URL + langs) ──
app.get('/api/config', (_req, res) => {
  res.json({
    livekitUrl: config.livekit.url,
    languages: config.languages,
    sessionActive: !!session && !session.stopped,
  });
});

// ── Speaker: start a broadcast ──
app.post('/api/session/start', async (req, res) => {
  try {
    if (session && !session.stopped) {
      return res.status(409).json({ error: 'A session is already live. Stop it first.' });
    }
    const mode = req.body?.mode === 'direct' ? 'direct' : 'cascade';
    session = new BroadcastSession({ mode });
    await session.start();

    const listenUrl = `${config.publicBaseUrl}/listen.html?s=${session.id}`;
    const qrDataUrl = await QRCode.toDataURL(listenUrl, { margin: 1, width: 320 });

    res.json({ sessionId: session.id, room: session.roomName, mode, listenUrl, qrDataUrl });
  } catch (e) {
    console.error('[start]', e);
    res.status(500).json({ error: e?.message || 'Failed to start session' });
  }
});

// ── Speaker: stop ──
app.post('/api/session/stop', async (_req, res) => {
  if (!session) return res.json({ ok: true });
  await session.stop();
  session = null;
  res.json({ ok: true });
});

// ── Speaker: live status (listener counts, transcript, uptime) ──
app.get('/api/session/status', (_req, res) => {
  if (!session || session.stopped) return res.json({ active: false });
  res.json({ active: true, ...session.status() });
});

// ── Listener: get a subscribe-only token for the active room ──
app.post('/api/listener/token', async (req, res) => {
  try {
    if (!session || session.stopped) return res.status(404).json({ error: 'No live session right now.' });
    const lang = String(req.body?.lang || '');
    if (!config.languageCodes.includes(lang)) return res.status(400).json({ error: 'Unsupported language.' });

    const identity = `listener:${lang}:${Math.random().toString(36).slice(2, 8)}`;
    const token = await createListenerToken({ room: session.roomName, identity, name: `student-${lang}` });
    res.json({ token, url: config.livekit.url, room: session.roomName, lang, identity });
  } catch (e) {
    console.error('[listener/token]', e);
    res.status(500).json({ error: e?.message || 'Failed to issue token' });
  }
});

const server = http.createServer(app);

// ── Speaker mic stream over WebSocket ──
// Binary messages  = raw 16-bit PCM @ 16 kHz mono frames from the mic worklet.
// Text messages    = JSON control ({type:'pause'}).
const wss = new WebSocketServer({ server, path: '/ws/speaker' });

wss.on('connection', (ws) => {
  const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch { /* noop */ } };
  console.log('[ws] speaker connected; session=', session?.id, 'stopped=', session?.stopped);

  if (session && !session.stopped) {
    session.onTranscript = (t) => send({ type: 'transcript', ...t });
    session.onStatus = () => send({ type: 'status', ...session.status() });
    send({ type: 'ready', sessionId: session.id });
  } else {
    send({ type: 'error', error: 'Start a session before streaming audio.' });
  }

  let frames = 0;
  let bytes = 0;
  ws.on('message', (data, isBinary) => {
    if (!session || session.stopped) return;
    if (isBinary) {
      frames += 1;
      bytes += data.length;
      if (frames === 1) console.log('[ws] first audio frame received, bytes=', data.length);
      if (frames % 100 === 0) console.log(`[ws] audio frames=${frames} totalBytes=${bytes}`);
      session.pushSpeakerAudio(Buffer.from(data).toString('base64'));
    } else {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pause') session.pauseInput();
      } catch { /* ignore */ }
    }
  });

  // Push status snapshots to the speaker console once a second.
  const statusTimer = setInterval(() => {
    if (session && !session.stopped) send({ type: 'status', ...session.status() });
  }, 1000);

  ws.on('close', () => clearInterval(statusTimer));
});

server.listen(config.port, () => {
  console.log(`\n  live-interpreter listening on http://localhost:${config.port}`);
  console.log(`  Public base URL: ${config.publicBaseUrl}`);
  console.log(`  Languages: ${config.languageCodes.join(', ')}`);
  console.log(`  Speaker console: ${config.publicBaseUrl}/  (Start Broadcast)\n`);
});
