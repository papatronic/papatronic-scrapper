const { Pool } = require('pg')

// Creates Pool of Postgres clients as we will be executing many queries against the DB
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// Listening to errors on the PGPool...
pool.on('error', (err, client) => {
  console.error('Error on the IDLE Client: ', err);
  process.exit(-1);
});

// Async function that expects a full SQL statement and it's variables
// Both statement and variables will be parsed and sanitized by Node-Postgres
async function sendQuery(statement, variables) {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(statement, variables);
    return rows;
  } catch (error) {
    console.error(`Error executing statement: ${statement} with variables ${variables} | ${error}`);
  } finally {
    await client.release();
  }
}

async function disconnectPool() {
  console.log('Disconneting pool. Bye, bye...');
  await pool.end();
  console.log('Pool has been disconnected.');
}

module.exports = { sendQuery, disconnectPool };