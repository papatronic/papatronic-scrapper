const schedule = require('node-schedule');
const logger = require('./logger');
const run = require('./scrapper');

schedule.scheduleJob('0 23 * * *', async function() {
  logger.log('info', 'CronJob execution started');
  await run();
  logger.log('info', 'CronJob execution finished');
});