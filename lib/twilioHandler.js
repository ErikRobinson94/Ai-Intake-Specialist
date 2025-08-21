// lib/twilioHandler.js
// Generates TwiML that opens a Twilio <Connect><Stream> to your WS bridge.
// Exports in multiple styles so index.js can always resolve it.

require('dotenv').config();
const { twiml: { VoiceResponse } } = require('twilio');

function twilioVoiceHandler(req, res) {
  try {
    // Derive the public hostname and audio route
    const hostFromEnv = (process.env.AUDIO_STREAM_DOMAIN || process.env.HOSTNAME || '').replace(/^https?:\/\//, '');
    const hostFromReq = (req?.headers?.host || '').replace(/^https?:\/\//, '');
    const host = hostFromEnv || hostFromReq || 'localhost';

    const route = process.env.AUDIO_STREAM_ROUTE || '/audio-stream';
    const wsUrl = `wss://${host}${route}`;

    // Build TwiML
    const vr = new VoiceResponse();
    const connect = vr.connect();

    // Stream both directions; name the stream for easier debugging
    const attrs = { url: wsUrl, track: 'both' };
    const callSid = req?.body?.CallSid || req?.query?.CallSid;
    if (callSid) attrs.name = String(callSid);

    connect.stream(attrs);

    res.set('Content-Type', 'text/xml');
    res.status(200).send(vr.toString());
  } catch (err) {
    console.error('[twilioHandler] Failed to build TwiML:', err);
    res.status(500).type('text/plain').send('twilio handler error');
  }
}

// Export in all common shapes so index.js can pick it up
module.exports = twilioVoiceHandler;
module.exports.twilioVoiceHandler = twilioVoiceHandler;
module.exports.voiceHandler = twilioVoiceHandler;
module.exports.handler = twilioVoiceHandler;
module.exports.default = twilioVoiceHandler;
