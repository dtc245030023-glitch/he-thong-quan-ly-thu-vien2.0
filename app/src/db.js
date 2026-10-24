import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const { Pool, types } = pg;

// Keep PostgreSQL DATE values as ISO strings (YYYY-MM-DD) instead of JS Dates,
// avoiding timezone shifts when rendering due dates.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  query_timeout: 15_000,
  application_name: 'library-management-app',
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

export async function waitForDatabase({ attempts = 30, delayMs = 2_000 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      console.log('Database connection established.');
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Database not ready (attempt ${attempt}/${attempts}): ${error.code || error.message}`);
      if (attempt < attempts) await delay(delayMs);
    }
  }

  throw lastError ?? new Error('Database connection failed.');
}

export async function closeDatabase() {
  await pool.end();
}
