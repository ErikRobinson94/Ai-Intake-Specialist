// lib/twilioHandler.js
require('dotenv').config();
const { twiml: { VoiceResponse } } = require('twilio');

function wsUrl() {
  const route = process.env.AUDIO_STREAM_ROUTE || '/audio-stream';
  const host  = process.env.AUDIO_STREAM_DOMAIN || process.env.HOSTNAME || 'localhost';
  return `wss://${host}${route}`;
}

/**
 * Bidirectional Media Stream using <Connect><Stream>
 * - Twilio will send caller audio to your WS
 * - AND will play any Media frames you send back
 * Docs: https://www.twilio.com/docs/voice/twiml/stream  (<Connect><Stream> is bidirectional)
 */
function handleTwilioCall(_req, res) {
  const vr = new VoiceResponse();

  // IMPORTANT: Use <Connect><Stream> (not <Start><Stream>)
  const connect = vr.connect();
  connect.stream({
    url: wsUrl(),
    // No 'track' for <Connect><Stream>; Twilio will send you inbound audio
    // and accept outbound 'media' frames you send back over the same WS.
  });

  // Do NOT add <Pause> or any TwiML after <Connect><Stream>;
  // Twilio will not execute it until the stream is closed.

  res.type('text/xml').send(vr.toString());
}

module.exports = { handleTwilioCall };
