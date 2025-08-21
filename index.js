// index.js
require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan(process.env.LOG_LEVEL === 'debug' ? 'dev' : 'tiny'));

// ---- ENV ----
const PORT = process.env.PORT || 5002;
const HOSTNAME = process.env.HOSTNAME || 'localhost';
const AUDIO_STREAM_ROUTE = process.env.AUDIO_STREAM_ROUTE || '/audio-stream';

// ---- HEALTH ----
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// ---- TWILIO VOICE WEBHOOK (robust resolver) ----
let twilioVoiceHandler = null;
try {
  const twilioModule = require('./lib/twilioHandler');
  // support any export style
  twilioVoiceHandler =
    (typeof twilioModule === 'function' ? twilioModule : null) ||
    twilioModule?.twilioVoiceHandler ||
    twilioModule?.voiceHandler ||
    twilioModule?.handler ||
    twilioModule?.default;

  if (typeof twilioVoiceHandler !== 'function') {
    console.error('[startup] Could not resolve a function export from lib/twilioHandler.js. Falling back to 500 handler.');
    twilioVoiceHandler = (_req, res) => res.status(500).type('text/plain').send('twilio handler not configured');
  }
} catch (e) {
  console.error('[startup] Failed to require ./lib/twilioHandler:', e?.message || e);
  twilioVoiceHandler = (_req, res) => res.status(500).type('text/plain').send('twilio handler load error');
}
app.post('/twilio/voice', twilioVoiceHandler);

// ---- STATIC WEB DEMO (serve at "/") ----
const STATIC_DIR = path.join(__dirname, 'web', 'public');
app.use(express.static(STATIC_DIR));
app.get('/', (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ---- HTTP SERVER + WEBSOCKETS ----
const server = http.createServer(app);

// Twilio <Stream> <-> Deepgram Agent bridge (phone calls)
const { setupAudioStream } = require('./lib/audio-stream');
setupAudioStream(server, { route: AUDIO_STREAM_ROUTE });

// Browser mic <-> Deepgram Agent bridge (NO Twilio)
const { setupWebDemoLive } = require('./web-demo-live');
setupWebDemoLive(server, { route: '/web-demo/ws' });

server.listen(PORT, '0.0.0.0', () => {
  console.log('[%s] info server_listen', new Date().toISOString(), {
    url: `http://0.0.0.0:${PORT}`,
    healthz: '/healthz',
    twilio_voice: '/twilio/voice',
    ws_audio_stream: AUDIO_STREAM_ROUTE,
    ws_web_demo: '/web-demo/ws'
  });
});
