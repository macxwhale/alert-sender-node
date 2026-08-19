'use strict';
const path = require('path');
const { Service } = require('node-windows');
const svc = new Service({
  name: 'AlertSenderService (Node)',
  script: path.join(__dirname, '..', 'src', 'index.js'),
});
svc.on('uninstall', () => console.log('Uninstalled.'));
svc.uninstall();
