const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

async function initDB() {
    try {
        // Create Users Table
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role VARCHAR(50) NOT NULL CHECK(role IN ('student', 'warden', 'staff'))
        )`);
        
        // Create Complaints Table
        await pool.query(`CREATE TABLE IF NOT EXISTS complaints (
            id SERIAL PRIMARY KEY,
            student_id INTEGER NOT NULL REFERENCES users(id),
            category VARCHAR(255) NOT NULL,
            description TEXT NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'In Progress', 'Resolved', 'Rejected')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP
        )`);

        // Seed Initial Users
        const checkUser = 'SELECT id FROM users WHERE username = $1';
        const insertUser = 'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)';
        
        const usersToSeed = [
            { username: 'student1', rawPass: 'pass123', role: 'student' },
            { username: 'warden1', rawPass: 'pass123', role: 'warden' },
            { username: 'staff1', rawPass: 'pass123', role: 'staff' },
        ];

        for (const u of usersToSeed) {
            const res = await pool.query(checkUser, [u.username]);
            if (res.rows.length === 0) {
                const hashedPass = await bcrypt.hash(u.rawPass, 10);
                await pool.query(insertUser, [u.username, hashedPass, u.role]);
                console.log(`Seeded user: ${u.username}`);
            }
        }
        console.log('Connected to the PostgreSQL database and initialized.');
    } catch (err) {
        console.error('Database initialization failed:', err);
    }
}

initDB();

module.exports = {
  query: (text, params) => pool.query(text, params),
};
