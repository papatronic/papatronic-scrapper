require('dotenv').config();
const moment = require('moment');
const cheerio = require('cheerio');
const rp = require('request-promise');
const Queries = require('./queries.json');
const config = require('./sniimConfig.json');
const { sendQuery, disconnectPool } = require('./db');

function generateURL(typeOfPrice = 1, rowsPerPage = 1000, year) {
  const currentYear = `${moment().format('D')}/${moment().month() + 1}/${year}`;
  const nextYear = `${moment().format('D')}/${moment().month() + 1}/${year + 1}`;
  return `${config.baseURL}&fechaInicio=${currentYear}&fechaFinal=${nextYear}&PreciosPorId=${typeOfPrice}&RegistrosPorPagina=${rowsPerPage}`;
}

const markets = [];
async function createAndFetchMarket(name) {
  const foundMarket = markets.find((market) => market.marketname === name);
  if (foundMarket) return foundMarket;
  try {
    const [market] = await sendQuery(Queries.market.INSERT_MARKET, [name]);
    console.info(`Market ${market.marketname} created`);
    markets.push(market);
    return market;
  } catch (error) {
    console.log(error);
    process.exit(-1);
  }
}

async function crawlWebPage(url, sniimPriceType) {
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
      const rows = [];
      for (const child of tableRows['0'].children) {
        if (child.type && child.name && child.attribs && child.children && child.children.length) {
          const normalChilds = child.children.map(c => {
            if (c !== undefined && c.children && c.children.length) return c.children[0].data
          }).filter((element) => (element !== undefined));
          rows.push(normalChilds);
        }
      }
      for (const row of rows) {
        const rowLength = row.length;
        if (rowLength === 7 || rowLength === 8 && row[0] !== 'Fecha') {
          const sourceMarket = await createAndFetchMarket(row[2]);
          const endMarket = await createAndFetchMarket(row[3]);
          const values = [...row];
          values.splice(2, 2);
          values[2] = values[2].replace(',', '');
          values[3] = values[3].replace(',', '');
          values[4] = values[4].replace(',', '');
          values[2] = Math.round(Number(values[2]) * 100);
          values[3] = Math.round(Number(values[3]) * 100);
          values[4] = Math.round(Number(values[4]) * 100);
          const [returnedRow] = await sendQuery(rowLength === 7 ? Queries.price.INSERT_PRICE_NO_OBS : Queries.price.INSERT_PRICE_OBS, [...values, potato.potatoid, sourceMarket.marketid, endMarket.marketid, sniimPriceType]);
          console.info(`Price ${returnedRow.priceid} inserted`);
        }
      }
    }
  }
}

(async () => {
  const presentacionComercial = 1;
  const precioKilogramoCalculado = 2;
  let startingYear = 2009;
  for (let index = 0; index < 10; index++) {
    const urlComercial = generateURL(presentacionComercial, 30000, startingYear);
    const urlCalculado = generateURL(precioKilogramoCalculado, 30000, startingYear);
    await crawlWebPage(urlComercial, presentacionComercial);
    await crawlWebPage(urlCalculado, precioKilogramoCalculado);
    startingYear += 1;
  }
  await disconnectPool();
})();