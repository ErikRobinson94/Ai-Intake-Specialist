// index.js
require('dotenv').config();
const express = require('express');
const http = require('http');

const { handleTwilioCall } = require('./lib/twilioHandler');
const { setupAudioStream } = require('./lib/audio-stream');
const { setupWebDemoLive } = require('./web-demo-live'); // <- same web demo bridge

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Twilio Voice webhook: returns TwiML that starts the Media Stream
app.post('/twilio/voice', handleTwilioCall);

// Health
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ----- Single HTTP server (Render exposes one $PORT) -----
const server = http.createServer(app);

// 1) Twilio <-> Deepgram bridge WS (path comes from your audio-stream module / env)
setupAudioStream(server);

// 2) Browser-only web demo WS on the SAME server (no Twilio)
//    Mounted at /web-demo/ws so it coexists cleanly.
setupWebDemoLive(server, { route: '/web-demo/ws' });

const PORT = parseInt(process.env.PORT || '5002', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] info server_listen`, {
    url: `http://0.0.0.0:${PORT}`,
    healthz: `/healthz`,
    twilio_voice: `/twilio/voice`,
    ws_audio_stream: process.env.AUDIO_STREAM_ROUTE || '/audio-stream',
    ws_web_demo: '/web-demo/ws'
  });
});
