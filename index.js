'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5002;

/* ---------------- health & basics ---------------- */
app.use(express.json({ limit: '2mb' }));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.head('/', (_req, res) => res.status(200).end());

/* --------------- serve Next static export -------- */
const OUT_DIR = path.join(__dirname, 'web', 'out');
app.use(express.static(OUT_DIR, { extensions: ['html'] }));
app.use('/worklets', express.static(path.join(__dirname, 'web', 'public', 'worklets')));

/* --------------- load Twilio webhook (optional) -- */
// Avoid "Route.post() requires a callback" if handler is missing.
function pickHandler(mod) {
  if (!mod) return undefined;
  if (typeof mod === 'function') return mod;                 // module.exports = fn
  if (typeof mod.default === 'function') return mod.default; // export default fn
  if (typeof mod.twilioHandler === 'function') return mod.twilioHandler; // exports.twilioHandler
  return undefined;
}

function loadTwilioHandler() {
  const candidates = [
    './twilio',
    './server/twilio',
    './src/twilio',
    './api/twilio',
    './dist/twilio',
    './dist/server/twilio',
  ];
  for (const rel of candidates) {
    try {
      const mod = require(path.join(__dirname, rel));
      const handler = pickHandler(mod);
      if (typeof handler === 'function') {
        console.log(`[startup] Twilio handler loaded from ${rel}`);
        return handler;
      }
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.warn(`[startup] Tried ${rel} → ${e.message}`);
      }
    }
  }
  return undefined;
}

const twilioHandler = loadTwilioHandler();
if (twilioHandler) {
  app.post('/twilio/voice', twilioHandler);
} else {
  console.warn('[startup] Twilio handler NOT found. /twilio/voice will be a NOOP.');
  app.post('/twilio/voice', (_req, res) => {
    res.type('text/plain').send('Twilio not configured on this build.');
  });
}

/* --------------- WebSockets: /web-demo/ws & /audio-stream -------- */
// Single upgrade path to avoid "handleUpgrade called more than once"
const wssWebDemo = new WebSocket.Server({ noServer: true });
const wssAudioStream = new WebSocket.Server({ noServer: true });

// tiny PCM16 test tone to prove audio path after connect
function buildTestTone() {
  const sr = 16000, durSec = 0.5, frames = Math.floor(sr * durSec);
  const buf = Buffer.alloc(frames * 2);
  const f = 440;
  for (let i = 0; i < frames; i++) {
    const s = Math.sin((2 * Math.PI * f * i) / sr) * 0.25; // -12 dBFS
    buf.writeInt16LE((s * 32767) | 0, i * 2);
  }
  return buf;
}
const TEST_TONE = buildTestTone();

wssWebDemo.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const voiceId = url.searchParams.get('voiceId') || '1';

  console.log('[web-demo] connected', { ip: req.socket.remoteAddress, voiceId });

  // Let the client know the socket is ready
  ws.send(JSON.stringify({ type: 'server-ready', voiceId }));

  // Immediately push a short tone so you KNOW audio out works in Render
  try { ws.send(TEST_TONE); } catch {}

  ws.on('message', (data, isBinary) => {
    // Mic PCM frames arrive here if your page streams them.
    // Bridge to Deepgram agent here (unchanged from your local code).
    // Example: if (!isBinary) console.log('msg:', data.toString());
  });

  ws.on('close', () => console.log('[web-demo] disconnected'));
});

wssAudioStream.on('connection', (ws) => {
  console.log('[audio-stream] connected');
  ws.on('close', () => console.log('[audio-stream] disconnected'));
});

server.on('upgrade', (req, socket, head) => {
  try {
    if (req.url.startsWith('/web-demo/ws')) {
      wssWebDemo.handleUpgrade(req, socket, head, (ws) => {
        wssWebDemo.emit('connection', ws, req);
      });
    } else if (req.url.startsWith('/audio-stream')) {
      wssAudioStream.handleUpgrade(req, socket, head, (ws) => {
        wssAudioStream.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  } catch (e) {
    console.error('[upgrade] error', e);
    try { socket.destroy(); } catch {}
  }
});

/* --------------- fallback to index.html -------------- */
app.get('*', (_req, res) => res.sendFile(path.join(OUT_DIR, 'index.html')));

/* --------------- boot ---------------- */
server.listen(PORT, '0.0.0.0', () => {
  console.log('[server_listen]', {
    url: `http://0.0.0.0:${PORT}`,
    healthz: '/healthz',
    twilio_voice: '/twilio/voice',
    ws_audio_stream: '/audio-stream',
    ws_web_demo: '/web-demo/ws'
  });
});


