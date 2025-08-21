// web-demo-bus.js
// Tiny shared event bus for the web demo.
// Used for lightweight status/debug messages across modules.

const { EventEmitter } = require('events');
const bus = new EventEmitter();

// allow multiple listeners without warnings
bus.setMaxListeners(50);

// Optional: log 'status' events to server console for easy visibility.
bus.on('status', (msg) => {
  try {
    if (!msg) return;
    console.log(`[web-demo] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  } catch {}
});

module.exports = bus;
