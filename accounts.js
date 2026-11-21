const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const REMOVE_PASSWORD = '1234';
const TIMEZONE = 'Africa/Lusaka';

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS numbers (
            phone TEXT PRIMARY KEY,
            password TEXT,
            added_at BIGINT
        );
    `);
}

async function getAll() {
    const { rows } = await pool.query(
        `SELECT * FROM numbers ORDER BY added_at ASC NULLS LAST, phone ASC`
    );
    return rows.map(r => ({
        phone: r.phone,
        password: r.password,
        addedAt: r.added_at ? Number(r.added_at) : null
    }));
}

async function count() {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM numbers`);
    return rows[0].c;
}

async function exists(phone) {
    const { rows } = await pool.query(`SELECT 1 FROM numbers WHERE phone = $1`, [phone]);
    return rows.length > 0;
}

async function add(phone, password) {
    await pool.query(
        `INSERT INTO numbers (phone, password, added_at) VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO NOTHING`,
        [phone, password, Date.now()]
    );
}

async function remove(phone) {
    await pool.query(`DELETE FROM numbers WHERE phone = $1`, [phone]);
}

async function changeAll(oldPass, newPass) {
    if (oldPass) {
        const r = await pool.query(`UPDATE numbers SET password = $1 WHERE password = $2`, [newPass, oldPass]);
        return r.rowCount;
    }
    const r = await pool.query(`UPDATE numbers SET password = $1`, [newPass]);
    return r.rowCount;
}

module.exports = { pool, initDB, getAll, count, exists, add, remove, changeAll, REMOVE_PASSWORD, TIMEZONE };
