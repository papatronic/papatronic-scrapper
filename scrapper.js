require('dotenv').config();
const moment = require('moment-timezone');
const cheerio = require('cheerio');
const rp = require('request-promise');
const logger = require('./logger');
const Queries = require('./queries.json');
const config = require('./sniimConfig.json');
const { sendQuery, disconnectPool } = require('./db');

/**
 * Gets the potatoes stored in database and returns them.
 */
async function fetchPotatoes() {
  try {
    return await sendQuery(Queries.potatoes.FETCH_ALL_POTATOES);
  } catch (error) {
    logger.log('error', `Failed to fetch potatoes from DB - ${error}.`);
    process.exit(-1);
  }
}

const markets = [];
/**
 * Fetches or creates a Market.
 * @param {string} name - Name of the market to create/obtain
 */
async function fetchOrCreateMarket(name) {
  const cachedMarket = markets.find((market) => market.marketname === name);
  if (cachedMarket) {
    logger.log('info', `Market ${cachedMarket.marketname} fetched from cache.`);
    return cachedMarket;
  }
  try {
    const [foundMarket] = await sendQuery(Queries.market.GET_BY_NAME, [name]);
    if (!foundMarket) {
      const [createdMarket] = await sendQuery(Queries.market.INSERT_MARKET, [name]);
      logger.log('info', `Market ${createdMarket.marketname} created.`);
      markets.push(createdMarket);
      return createdMarket;
    }
    logger.log('info', `Market ${foundMarket.marketname} found in database`);
    markets.push(foundMarket);
    return foundMarket;
  } catch (error) {
    logger.log('error', `An error occurred while creating the Market in Postgres. ${error}.`);
    process.exit(-1);
  }
}

/**
 * Formats and inserts each row into Price table in Postgres.
 * @param {object[]} rows - Array of information crawled from the webpage
 * @param {number} potatoID - Int representing the ID of the Potato which this price references to
 * @param {string} sniimPresentation - Enum (COMERCIAL, CALCULADO) representing the presentation of the fetched values from the webpage. Analogous to sniimPriceType (1 = 'COMERCIAL', 2 = 'CALCULADO')
 */
async function insertRows(rows, potatoID, sniimPresentation, source) {
  for (let index = 0, rowsLength = rows.length; index < rowsLength; index++) {
    const row = rows[index];
    row[0] = row[0].split('/').reverse().join('-');
    if (moment(row[0]).format() !== 'Invalid date') {
      let sourceMarket;
      let endMarket;
      if (source) {
        sourceMarket = await fetchOrCreateMarket('Sinaloa');
        endMarket = await fetchOrCreateMarket(row[2]);
      } else {
        sourceMarket = await fetchOrCreateMarket(row[2]);
        endMarket = await fetchOrCreateMarket('Sinaloa');
      }
      const values = [...row];
      values.splice(2, 1);
      values.splice(1, 0, moment(values[0]).toDate());
      values[3] = values[3].replace('.', '');
      values[4] = values[4].replace('.', '');
      values[5] = values[5].replace('.', '');
      try {
        const [returnedRow] = await sendQuery(row.length === 7 ? Queries.price.INSERT_PRICE_OBS : Queries.price.INSERT_PRICE_NO_OBS, [...values, potatoID, sourceMarket.marketid, endMarket.marketid, sniimPresentation]);
        logger.log('info', `Price ${returnedRow.priceid} created.`);
      } catch (error) {
        logger.log('error', `An error occurred while creating the Price in Postgres. ${error}.`);
        process.exit(-1);
      } 
    }
  }
}

/**
 * Crawls the webpage and filters the table rows in order to clear them and store them in Postgres.
 * @param {string} url - The URL from where to fetch the records
 */
async function fetchAndFilterWebpage(url) {
  let $;
  try {
    $ = await rp({
      method: 'POST',
      uri: url,
      transform: function (body) {
        return cheerio.load(body);
      }
    });
  } catch (error) {
    logger.log('error', `Error while fetching the webpage from the SNIIM. Got ${error}.`);
    process.exit(-1);
  }
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
    return rows;
  }
  return [];
}

/**
 * Generates a pair of URLs that the function crawlWebPage will fetch. By default it returns both URL's with a day difference. One URL corresponds from prices leaving Sinaloa and the other places coming to Sinaloa.
 * @param {string} sniimPriceType - Int (1 or 2) representing which prices the URL must fetch.
 * @param {number} rowsPerPage - Int representing how many records the URL will fetch. Defaults to 1000.
 */
function generateURL(sniimPriceType, rowsPerPage = 1000) {
  const year = moment().year();
  const month = moment().month() + 1;
  const yesterday = `${moment().subtract(1, 'days').format('DD')}/${month}/${year}`;
  const today = `${moment().format('DD')}/${month}/${year}`;
  return [
    `${config.baseURL}&fechaInicio=${yesterday}&fechaFinal=${today}&PreciosPorId=${sniimPriceType}&RegistrosPorPagina=${rowsPerPage}&OrigenId=25$Origen=Sinaloa&DestinoId=-1&Destino=Todos`,
    `${config.baseURL}&fechaInicio=${yesterday}&fechaFinal=${today}&PreciosPorId=${sniimPriceType}&RegistrosPorPagina=${rowsPerPage}&OrigenId=-1$Origen=Todos&DestinoId=250&Destino=Sinaloa`,
  ];
}

/**
 * Starts the process of crawling a webpage (with the calculated price), filtering and clearing the data, then storing it into Postgres
 * @param {array} potatoes - The potatoes fetched from database
 */
async function crawlCalculatedPrice(potatoes) {
  const CALCULATED_PRICE = 2;
  const urls = generateURL(CALCULATED_PRICE, 50000);
  for (const url of urls) {
    for (const { potatosniimid, potatoid } of potatoes) {
      logger.log('info', `Fetching ${url}`);
      const webPageRows = await fetchAndFilterWebpage(url, potatosniimid);
      await insertRows(webPageRows, potatoid, 'CALCULADO');
    } 
  }
}

/**
 * Generates a two URL's to fetch all historic values.
 */
function generateHistoricURLs() {
  return [{
    url: `${config.baseURL}?&fechaInicio=01/01/1998&fechaFinal=${moment().format('DD/MM/YYYY')}&PreciosPorId=2&RegistrosPorPagina=1000000&OrigenId=25&Origen=Sinaloa&DestinoId=-1&Destino=Todos`, source: true,
  }, {
    url: `${config.baseURL}?&fechaInicio=01/01/1998&fechaFinal=${moment().format('DD/MM/YYYY')}&PreciosPorId=2&RegistrosPorPagina=1000000&OrigenId=-1&Origen=Todos&DestinoId=250&Destino=Sinaloa`, source: false
  }];
}

/**
 * Generates a single URL to fetch all historic values. Is extremely intensive.
 * @param {array} potatoes - The potatoes fetched from database
 */
async function fetchHistoricValues(potatoes) {
  const calculatedURLS = generateHistoricURLs();
  for (const { url, source } of calculatedURLS) {
    for (const { potatosniimid, potatoid } of potatoes) {
      const urlWithPotatoe = `${url}&ProductoId=${potatosniimid}`;
      logger.log('info', `Fetching ${urlWithPotatoe}`);
      const webPageRows = await fetchAndFilterWebpage(urlWithPotatoe);
      await insertRows(webPageRows, potatoid, 'CALCULADO', source);
    }
  }
}

async function run() {
  const potatoes = await fetchPotatoes();
  await fetchHistoricValues(potatoes);
  await disconnectPool();
}

(async () => {
  await run();
})();

module.exports = run;