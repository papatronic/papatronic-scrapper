require('dotenv').config();
const moment = require('moment');
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
    logger.log('info', `Market ${foundMarket.name} found in database`);
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
async function insertRows(rows, potatoID, sniimPresentation) {
  for (const row of rows) {
    const rowLength = row.length;
    if (rowLength === 7 || rowLength === 8 && row[0] !== 'Fecha') {
      const sourceMarket = await fetchOrCreateMarket(row[2]);
      const endMarket = await fetchOrCreateMarket(row[3]);
      const values = [...row];
      values.splice(2, 2);
      values[0] = values[0].split('/').reverse().join('-');
      values.splice(1, 0, new Date(values[0]));
      values[3] = values[3].replace(',', '');
      values[4] = values[4].replace(',', '');
      values[5] = values[5].replace(',', '');
      values[3] = Math.round(Number(values[3]) * 100);
      values[4] = Math.round(Number(values[4]) * 100);
      values[5] = Math.round(Number(values[5]) * 100);
      try {
        const [returnedRow] = await sendQuery(rowLength === 7 ? Queries.price.INSERT_PRICE_NO_OBS : Queries.price.INSERT_PRICE_OBS, [...values, potatoID, sourceMarket.marketid, endMarket.marketid, sniimPresentation]);
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
 * @param {number} potatoSNIIMId - The SNIIM ID of the potato from where to get the records
 */
async function fetchAndFilterWebpage(url, potatoSNIIMId) {
  let $;
  try {
    $ = await rp({
      method: 'POST',
      uri: `${url}&ProductoId=${potatoSNIIMId}`,
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
 * Generates a URL that the function crawlWebPage will fetch. By default it returns URL's with a day difference.
 * @param {string} sniimPriceType - Int (1 or 2) representing which prices the URL must fetch.
 * @param {number} rowsPerPage - Int representing how many records the URL will fetch. Defaults to 1000.
 */
function generateURL(sniimPriceType, rowsPerPage = 1000) {
  const year = moment().year();
  const month = moment().month() + 1;
  const yesterday = `${moment().subtract(1, 'days').format('DD')}/${month}/${year}`;
  const today = `${moment().format('DD')}/${month}/${year}`;
  return `${config.baseURL}&fechaInicio=${yesterday}&fechaFinal=${today}&PreciosPorId=${sniimPriceType}&RegistrosPorPagina=${rowsPerPage}`;
}

/**
 * Starts the process of crawling a webpage (with the calculated price), filtering and clearing the data, then storing it into Postgres
 * @param {array} potatoes - The potatoes fetched from database
 */
async function crawlCalculatedPrice(potatoes) {
  const CALCULATED_PRICE = 2;
  const CALCULATED_PRICE_URL = generateURL(CALCULATED_PRICE, 50000);
  for (const { potatosniimid, potatoid } of potatoes) {
    logger.log('info', `Fetching ${CALCULATED_PRICE_URL}`);
    const webPageRows = await fetchAndFilterWebpage(CALCULATED_PRICE_URL, potatosniimid);
    await insertRows(webPageRows, potatoid, 'CALCULADO');
  }
}

/**
 * Starts the process of crawling a webpage (with the commercial price), filtering and clearing the data, then storing it into Postgres
 * @param {array} potatoes - The potatoes fetched from database
 */
async function crawlCommercialPrice(potatoes) {
  const COMMERCIAL_PRICE = 1;
  const COMMERCIAL_PRICE_URL = generateURL(COMMERCIAL_PRICE, 50000);
  for (const { potatosniimid, potatoid } of potatoes) {
    logger.log('info', `Fetching ${COMMERCIAL_PRICE_URL}`);
    const webPageRows = await fetchAndFilterWebpage(COMMERCIAL_PRICE_URL, potatosniimid);
    await insertRows(webPageRows, potatoid, 'COMERCIAL');
  }
}


/**
 * Generates an array with URL of years in ascending order - starting from January 1st and finishing on December 31st of each year.
 * @param {number} sniimPriceType - Int (1 or 2) representing which prices the URL must fetch.
 * @param {number} rowsPerPage - Int representing how many records the URL will fetch. Defaults to 1000.
 * @param {number} yearsBeforeNow - Int representing the years to substract from this year. Defaults to 10 years.
 */
function generateHistoricURLs(sniimPriceType, rowsPerPage = 1000, yearsBeforeNow = 10) {
  const urls = [];
  let currentYear = moment().subtract(yearsBeforeNow, 'years').year();
  for (let index = 0; index < yearsBeforeNow; index++) {
    const start = `01/01/${currentYear}`;
    const finish = `31/12/${currentYear}`;
    urls.push(`${config.baseURL}&fechaInicio=${start}&fechaFinal=${finish}&PreciosPorId=${sniimPriceType}&RegistrosPorPagina=${rowsPerPage}`);
    currentYear += 1;
  }
  return urls;
}
 
/**
 * Crawls the webpage year by year and stores the values in database
 * @param {array} potatoes - The potatoes fetched from database
 */
async function fetchHistoricValues(potatoes) {
  const calculatedURLS = generateHistoricURLs(2, 50000, 30);
  for (const url of calculatedURLS) {
    for (const { potatosniimid, potatoid } of potatoes) {
      logger.log('info', `Fetching ${url}`);
      const webPageRows = await fetchAndFilterWebpage(url, potatosniimid);
      await insertRows(webPageRows, potatoid, 'CALCULADO');
    }
  }
  const commercialURLS = generateHistoricURLs(1, 50000, 30);
  for (const url of commercialURLS) {
    for (const { potatosniimid, potatoid } of potatoes) {
      logger.log('info', `Fetching ${url}`);
      const webPageRows = await fetchAndFilterWebpage(url, potatosniimid);
      await insertRows(webPageRows, potatoid, 'COMERCIAL');
    }
  }
}

(async () => {
  const potatoes = await fetchPotatoes();
  await crawlCalculatedPrice(potatoes);
  await crawlCommercialPrice(potatoes);
  await disconnectPool();
})();