// lib/twilioHandler.js
'use strict';

/**
 * No-op Twilio webhook to keep existing route stable.
 * Replace with your Twilio logic when you’re ready.
 */
function registerTwilio(app, { route = '/twilio/voice' } = {}) {
  app.post(route, (req, res) => {
    // Basic TwiML: do nothing but respond 200 so Twilio stops retrying
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  });
}

module.exports = { registerTwilio };
