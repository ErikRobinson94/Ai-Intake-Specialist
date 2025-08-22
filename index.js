// index.js
// Minimal, production-safe HTTP + WebSocket server for Render
// - Serves the exported Next app from /web/out
// - Exposes a single, safe upgrade handler so we never call handleUpgrade twice
// - Provides /web-demo/ws for the browser demo (with clear logs)
// - Keeps a Twilio webhook at /twilio/voice (no-op if your handler isn't found)

const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 5002;

const app = express();
app.set('trust proxy', 1);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ---------- health ----------
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ---------- static: Next "output: export" ----------
const outDir = path.join(__dirname, 'web', 'out');
app.use(express.static(outDir, { index: ['index.html'] }));

// Root -> exported index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(outDir, 'index.html'));
});

// ---------- Twilio webhook (kept; no-op if handler missing) ----------
let twilioHandler;
try {
  // support either ./twilio/voice.js (exports.twilioHandler) or ./twilio.js
  twilioHandler =
    (require('./twilio/voice') && require('./twilio/voice').twilioHandler) ||
    (require('./twilio') && require('./twilio').twilioHandler);
} catch (e) {
  console.warn('[startup] twilioHandler export not found; /twilio/voice will be a no-op');
}
app.post('/twilio/voice', twilioHandler || ((_req, res) => res.type('text/xml').send('<Response/>')));

// ---------- HTTP server so we can manage 'upgrade' safely ----------
const server = http.createServer(app);

// ---------- WebSocket: Web Demo ----------
const wssWebDemo = new WebSocketServer({ noServer: true });

wssWebDemo.on('connection', (ws, req, ctx) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log('[web-demo] connected', { ip, voiceId: ctx.voiceId });

  // Tell the client we're ready. Your real pipeline can start from here.
  ws.send(JSON.stringify({ type: 'server_ready', voiceId: ctx.voiceId }));

  // Keepalive so Render/ingress doesn’t drop idle sockets
  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25000);

  ws.on('message', (data) => {
    // Simple echo/heartbeat for debugging
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      }
    } catch {
      // ignore binary/raw frames
    }
  });

  ws.on('close', () => {
    clearInterval(keepAlive);
    console.log('[web-demo] disconnected');
  });
});

// ---------- (Optional) WebSocket: raw audio stream ----------
const wssAudio = new WebSocketServer({ noServer: true });
wssAudio.on('connection', (_ws, _req) => {
  console.log('[audio-stream] connected');
});

// ---------- Single, safe upgrade router (prevents double-upgrade crash) ----------
server.on('upgrade', (req, socket, head) => {
  try {
    const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);

    if (pathname === '/web-demo/ws') {
      const voiceId = searchParams.get('voiceId') || '1';
      wssWebDemo.handleUpgrade(req, socket, head, (ws) => {
        wssWebDemo.emit('connection', ws, req, { voiceId });
      });
      return;
    }

    if (pathname === '/audio-stream') {
      wssAudio.handleUpgrade(req, socket, head, (ws) => {
        wssAudio.emit('connection', ws, req);
      });
      return;
    }

    // Not a known ws route
    socket.destroy();
  } catch (err) {
    console.error('[upgrade] error', err);
    socket.destroy();
  }
});

// ---------- listen ----------
server.listen(PORT, '0.0.0.0', () => {
  console.log('[server_listen]', {
    url: `http://0.0.0.0:${PORT}`,
    healthz: '/healthz',
    twilio_voice: '/twilio/voice',
    ws_audio_stream: '/audio-stream',
    ws_web_demo: '/web-demo/ws',
  });
});
