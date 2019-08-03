require('dotenv').config();
const moment = require('moment');
const cheerio = require('cheerio');
const rp = require('request-promise');
const Queries = require('./queries.json');
const config = require('./sniimConfig.json');
const { sendQuery, disconnectPool } = require('./db');

function generateURL(typeOfPrice = 1, yearsFromNow = 1, rowsPerPage = 1000) {
  const yesterday = `${moment().format('D')}/${moment().month() + 1}/${moment().subtract(yearsFromNow, 'years').year()}`;
  const today = `${moment().format('D')}/${moment().month() + 1}/${moment().year()}`;
  return `${config.baseURL}&fechaInicio=${yesterday}&fechaFinal=${today}&PreciosPorId=${typeOfPrice}&RegistrosPorPagina=${rowsPerPage}`;
}

async function crawlWebPage(url) {
  const potatoes = await sendQuery(Queries.potatoes.FETCH_ALL_POTATOES);
  for (const potato of potatoes) {
    const $ = await rp({
      method: 'POST',
      uri: `${url}&ProductoId=${potato.potatosniimid}`,
      transform: function (body) {
        return cheerio.load(body);
      }
    });
    const tableRows = $('#tblResultados > tbody');
    if (tableRows && tableRows['0']) {
      for (const child of tableRows['0'].children) {
        if (child.type && child.name && child.attribs && child.children) {
          const { type, name, attribs, children: childChildren } = child;
          for (const childChild of childChildren) {
            if (childChild.children) {
              console.log({ ch: childChild.children });
            }
          }
        }
      }
    }
  }
}

(async () => {
  const presentacionComercial = 1;
  const urlComercial = generateURL(presentacionComercial, 1, 10000);
  const precioKilogramoCalculado = 2;
  const urlCalculado = generateURL(precioKilogramoCalculado, 1, 10000);
  // await crawlWebPage(urlComercial);
  await crawlWebPage(urlCalculado);
  await disconnectPool();
})();