require('dotenv').config();
const moment = require('moment');
const cheerio = require('cheerio');
const rp = require('request-promise');
const Queries = require('./queries.json');
const config = require('./sniimConfig.json');
const { sendQuery, disconnectPool } = require('./db');

async function crawlWebPage() {
  // Default date (for demonstration) is one year before today
  const potatoes = await sendQuery(Queries.potatoes.FETCH_ALL_POTATOES);
  const yesterday = `${moment().format('D')}/${moment().month() + 1}/${moment().subtract(1, 'years').year()}`;
  const today = `${moment().format('D')}/${moment().month() + 1}/${moment().year()}`;
  const url = `${config.baseURL}&fechaInicio=${yesterday}&fechaFinal=${today}`;
  for (const potato of potatoes) {
    const $ = await rp({
      method: 'POST',
      uri: `${url}&ProductoId=${potato.potatosniimid}`,
      transform: function (body) {
        return cheerio.load(body);
      }
    });
    const tableRows = $('#tblResultados > tbody');
    const children = tableRows.children();
    const childrenOwnKeys = Reflect.ownKeys(children);
    for (const child in childrenOwnKeys) {
      if (children[child].name === 'tr') {
        // TO DO: Analyze the data and insert it into Postgres.
      }
    }
  }
  await disconnectPool();
}

(async () => {
    await crawlWebPage();
})();