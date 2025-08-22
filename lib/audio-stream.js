// lib/audio-stream.js
'use strict';

/**
 * Minimal passthrough WS for raw PCM audio.
 * This is kept to preserve your existing route and future Twilio wiring.
 */

function setupAudioStream(app, { route = '/audio-stream' } = {}) {
  app.ws(route, (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log('[audio-stream] connected', { ip });

    ws.on('message', (data, isBinary) => {
      // Echo back to verify the pipe (can be replaced with DSP / ASR feed later)
      if (isBinary) {
        try { ws.send(data, { binary: true }); } catch {}
      }
    });

    ws.on('close', (code, reason) => {
      console.log('[audio-stream] closed', { code, reason: reason?.toString() });
    });

    ws.on('error', (err) => {
      console.error('[audio-stream] error', err.message);
    });
  });
}

module.exports = { setupAudioStream };
