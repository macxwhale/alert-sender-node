'use strict';
// Installs the poller as a Windows Service (like the original .NET service).
// Requires: npm i node-windows  (and run as Administrator).
const path = require('path');
let Service;
try { ({ Service } = require('node-windows')); }
catch (_) { console.error('node-windows not installed. Run: npm i node-windows'); process.exit(1); }

const svc = new Service({
  name: 'AlertSenderService (Node)',
  description: 'Polls SQL Server and sends Email/SMS alerts (Node port).',
  script: path.join(__dirname, '..', 'src', 'index.js'),
  wait: 2, grow: 0.5,
});
svc.on('install', () => { console.log('Installed. Starting...'); svc.start(); });
svc.on('alreadyinstalled', () => console.log('Already installed.'));
svc.install();
