'use strict';
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');
const config = require('./config');

// Mirrors the old log4net setup: level-prefixed lines, rolling files under Log\.
const fmt = winston.format.printf(({ level, message, timestamp }) =>
  `${level.toUpperCase().padEnd(5)} :${timestamp} - ${message}`);

const logger = winston.createLogger({
  level: config.log.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MMM-DD.hh:mm:ss' }),
    fmt
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.DailyRotateFile({
      dirname: config.log.dir,
      filename: 'AlertSenderService-%DATE%.txt',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d',
    }),
  ],
});

module.exports = logger;
