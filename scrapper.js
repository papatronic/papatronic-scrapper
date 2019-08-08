require('dotenv').config();
const moment = require('moment');
const cheerio = require('cheerio');
const rp = require('request-promise');
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
    console.error(`[ERROR] Failed to fetch potatoes from DB - Error: ${error}.`);
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
    console.info(`[INFO] Market ${cachedMarket.marketname} fetched from cache.`);
    return cachedMarket;
  }
  try {
    const [foundMarket] = await sendQuery(Queries.market.GET_BY_NAME, [name]);
    if (!foundMarket) {
      const [createdMarket] = await sendQuery(Queries.market.INSERT_MARKET, [name]);
      console.info(`[INFO] Market ${createdMarket.marketname} created.`);
      markets.push(createdMarket);
      return createdMarket;
    }
    console.info(`[INFO] Market ${foundMarket.name} found in database`);
    markets.push(foundMarket);
    return foundMarket;
  } catch (error) {
    console.error(`[ERROR] An error occurred while creating the Market in Postgres. Error: ${error}.`);
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
      values[2] = values[2].replace(',', '');
      values[3] = values[3].replace(',', '');
      values[4] = values[4].replace(',', '');
      values[2] = Math.round(Number(values[2]) * 100);
      values[3] = Math.round(Number(values[3]) * 100);
      values[4] = Math.round(Number(values[4]) * 100);
      try {
        const [returnedRow] = await sendQuery(rowLength === 7 ? Queries.price.INSERT_PRICE_NO_OBS : Queries.price.INSERT_PRICE_OBS, [...values, potatoID, sourceMarket.marketid, endMarket.marketid, sniimPresentation]);
        console.info(`[INFO] Price ${returnedRow.priceid} created.`);
      } catch (error) {
        console.error(`[ERROR] An error occurred while creating the Price in Postgres. Error: ${error}.`);
        process.exit(-1);
      }
    }
  }
}

/**
 * Generates a URL that the function crawlWebPage will fetch. By default it returns URL's with a day difference.
 * @param {string} sniimPriceType - Int (1 or 2) representing which prices the URL must fetch.
 * @param {number} rowsPerPage - Int representing how many records the URL will fetch. Defaults to 1000.
 */
function generateURL(sniimPriceType, rowsPerPage = 1000) {
  if (!sniimPriceType || typeof sniimPriceType !== 'number') {
    console.error(`[ERROR] The variable sniimPriceType must be present and must be a number. Got ${sniimPriceType}.`);
    process.exit(-1);
  }
  const year = moment().year();
  const month = moment().month() + 1;
  const yesterday = `${moment().subtract(1, 'days').format('DD')}/${month}/${year}`;
  const today = `${moment().format('DD')}/${month}/${year}`;
  return `${config.baseURL}&fechaInicio=${yesterday}&fechaFinal=${today}&PreciosPorId=${sniimPriceType}&RegistrosPorPagina=${rowsPerPage}`;
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
    console.error(`[ERROR] Error while fetching the webpage from the SNIIM. Got ${error}.`);
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
 * Starts the process of crawling a webpage (with the calculated price), filtering and clearing the data, then storing it into Postgres
 * @param {array} potatoes - The potatoes fetched from database
 */
async function crawlCalculatedPrice(potatoes) {
  const CALCULATED_PRICE = 2;
  const CALCULATED_PRICE_URL = generateURL(CALCULATED_PRICE, 50000);
  for (const { potatosniimid, potatoid } of potatoes) {
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
    const webPageRows = await fetchAndFilterWebpage(COMMERCIAL_PRICE_URL, potatosniimid);
    await insertRows(webPageRows, potatoid, 'COMERCIAL');
  }
}

function generateTenYearsUrls(sniimPriceType, rowsPerPage = 1000) {
  const urls = [];
  const month = moment().month() + 1;
  let year = 2009;
  for (let index = 0; index < 10; index++) {
    const lastYear = `${moment().format('D')}/${month}/${year}`;
    const nextYear = `${moment().format('D')}/${month}/${year + 1}`;
    urls.push(`${config.baseURL}&fechaInicio=${lastYear}&fechaFinal=${nextYear}&PreciosPorId=${sniimPriceType}&RegistrosPorPagina=${rowsPerPage}`);
    year += 1;
  }
  return urls;
}

(async () => {
  const potatoes = await fetchPotatoes();
  const calculatedURLS = generateTenYearsUrls(2, 50000);
  const commercialURLS = generateTenYearsUrls(1, 50000);
  for (const url of calculatedURLS) {
    for (const { potatosniimid, potatoid } of potatoes) {
      const webPageRows = await fetchAndFilterWebpage(url, potatosniimid);
      await insertRows(webPageRows, potatoid, 'CALCULADO');
    }
  }
  for (const url of commercialURLS) {
    for (const { potatosniimid, potatoid } of potatoes) {
      const webPageRows = await fetchAndFilterWebpage(url, potatosniimid);
      await insertRows(webPageRows, potatoid, 'COMERCIAL');
    }
  }
  await disconnectPool();
})();