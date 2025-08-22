'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const url = require('url');
const { WebSocketServer } = require('ws');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5002;
const STATIC_DIR = path.join(__dirname, 'web', 'out');

/* ---------- Health ---------- */
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

/* ---------- Static site (Next export) ---------- */
app.use(express.static(STATIC_DIR, { extensions: ['html'] }));

/* Helpful message if someone HTTP GETs the WS endpoints */
app.get(['/web-demo/ws', '/audio-stream'], (_req, res) =>
  res.status(426).send('Use WebSocket (Upgrade: websocket)')
);

/* ---------- Twilio Voice webhook (safe, non-breaking) ---------- */
app.post('/twilio/voice', (req, res) => {
  try {
    const baseWs =
      process.env.TWILIO_STREAM_URL ||
      ((process.env.PUBLIC_WS_ORIGIN || `wss://${req.headers.host}`) + '/audio-stream');

    const twiml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      '  <Say voice="Polly.Joanna">Connecting you now.</Say>',
      `  <Connect><Stream url="${baseWs}"/></Connect>`,
      '</Response>',
    ].join('');

    res.type('text/xml').send(twiml);
  } catch {
    res
      .status(200)
      .type('text/xml')
      .send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>OK</Say></Response>');
  }
});

/* Fallback to index.html so refresh on deep links keeps working */
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

/* ---------- HTTP server + single guarded WS upgrade ---------- */
const server = http.createServer(app);

const wssWebDemo = new WebSocketServer({ noServer: true });
const wssAudioStream = new WebSocketServer({ noServer: true });

/* /web-demo/ws — the browser demo socket */
wssWebDemo.on('connection', (ws, req) => {
  const { query } = url.parse(req.url, true);
  const voiceId = Number(query?.voiceId) || 1;

  safeSend(ws, JSON.stringify({ type: 'status', status: `connected (voiceId=${voiceId})` }));

  // Send a short 1.2s 440Hz tone so you can confirm audio flows server->browser
  sendTestTone(ws).catch(() => {});

  ws.on('message', (data) => {
    // Binary data here is mic PCM16 from the browser; no ASR in this demo path
    if (typeof data === 'string') {
      // ignore debug text
    }
  });

  ws.on('close', () => {});
});

/* /audio-stream — stubbed WS for future Twilio Realtime wiring */
wssAudioStream.on('connection', (ws) => {
  safeSend(ws, JSON.stringify({ type: 'status', status: 'twilio stream connected' }));
  ws.on('message', () => {});
});

/* Handle upgrades ONCE, and route by pathname */
server.on('upgrade', (req, socket, head) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (pathname === '/web-demo/ws') {
      wssWebDemo.handleUpgrade(req, socket, head, (ws) => {
        wssWebDemo.emit('connection', ws, req);
      });
    } else if (pathname === '/audio-stream') {
      wssAudioStream.handleUpgrade(req, socket, head, (ws) => {
        wssAudioStream.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  } catch {
    socket.destroy();
  }
});

/* ---------- Start ---------- */
server.listen(PORT, () => {
  const base = `http://0.0.0.0:${PORT}`;
  console.log('[server_listen]', {
    url: base,
    healthz: '/healthz',
    twilio_voice: '/twilio/voice',
    ws_audio_stream: '/audio-stream',
    ws_web_demo: '/web-demo/ws',
  });
});

/* ---------- helpers ---------- */
function safeSend(ws, payload) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  } catch {}
}

async function sendTestTone(ws) {
  // 1.2s of 440 Hz at 24000 Hz, PCM16LE, chunked ~100ms frames
  const sampleRate = 24000;
  const durationSec = 1.2;
  const total = Math.floor(sampleRate * durationSec);
  const buf = new Int16Array(total);
  const freq = 440;
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const amp = Math.sin(2 * Math.PI * freq * t) * 0.25; // -12 dBFS
    buf[i] = amp < 0 ? amp * 0x8000 : amp * 0x7fff;
  }
  const chunk = 2400; // ~100ms at 24k
  for (let i = 0; i < total; i += chunk) {
    const slice = buf.subarray(i, Math.min(i + chunk, total));
    safeSend(ws, Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength));
    await new Promise((r) => setTimeout(r, 100));
  }
}
