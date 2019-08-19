const { createLogger, format, transports } = require('winston');
const fs = require('fs');

const filename = process.env.LOG_FILE || 'logs.txt';

const logger = createLogger({
  format: format.combine(
    format.label({ label: 'papatronic-scrapper' }),
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.simple()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename })
  ]
});

module.exports = logger;