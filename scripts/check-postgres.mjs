/**
 * Verifies DB_* reaches PostgreSQL. Run with:
 *   npm run check:postgres
 */
import pg from 'pg';

import { pgConfig } from './load-env.mjs';

const config = pgConfig();
const client = new pg.Client(config);
await client.connect();
const row = await client.query('SELECT current_database() AS db, current_user AS user');
await client.end();
console.log(`postgres ok. database=${row.rows[0].db} user=${row.rows[0].user}`);
