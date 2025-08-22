// index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

// Optional Twilio webhook (won’t hurt if you’re not using it)
let handleTwilioCall = (_req, res) => res.type('text/xml').send(
  '<Response><Say>OK</Say></Response>'
);
try {
  ({ handleTwilioCall } = require('./lib/twilioHandler'));
} catch {
  console.log('[startup] twilioHandler export not found; /twilio/voice will be a no-op');
}

// Optional audio-stream route (kept as a stub so it doesn’t crash)
try {
  const { setupAudioStream } = require('./lib/audio-stream');
  if (typeof setupAudioStream === 'function') {
    // you can mount it if you actually use it in Twilio flows
  }
} catch {}

const { setupWebDemoLive } = require('./web-demo-live');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ---- health
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ---- static: serve Next exported site from /web/out and /web/public
const OUT_DIR = path.join(__dirname, 'web', 'out');       // output: 'export'
const PUB_DIR = path.join(__dirname, 'web', 'public');
app.use(express.static(OUT_DIR));
app.use(express.static(PUB_DIR));

// ---- worklets under /worklets (explicit, helps when export paths differ)
app.use('/worklets', express.static(path.join(PUB_DIR, 'worklets')));

// ---- fallback to index.html for “/”
app.get('/', (_req, res) => res.sendFile(path.join(OUT_DIR, 'index.html')));

// ---- Twilio Voice webhook (safe if unused)
app.post('/twilio/voice', handleTwilioCall);

const server = http.createServer(app);

// ---- Browser web demo WS (same server)
setupWebDemoLive(server, { route: '/web-demo/ws' });

const PORT = parseInt(process.env.PORT || '5002', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log('[server_listen]', {
    url: `http://0.0.0.0:${PORT}`,
    healthz: '/healthz',
    twilio_voice: '/twilio/voice',
    ws_audio_stream: '/audio-stream',
    ws_web_demo: '/web-demo/ws',
  });
});
