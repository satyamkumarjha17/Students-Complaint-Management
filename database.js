const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./complaints.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        db.serialize(() => {
            // Create Users Table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('student', 'warden', 'staff'))
            )`);
            
            // Create Complaints Table
            db.run(`CREATE TABLE IF NOT EXISTS complaints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'In Progress', 'Resolved', 'Rejected')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                FOREIGN KEY(student_id) REFERENCES users(id)
            )`);

            // Seed Initial Users
            const seedUsers = async () => {
                const checkUser = db.prepare('SELECT id FROM users WHERE username = ?');
                const insertUser = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
                
                const usersToSeed = [
                    { username: 'student1', rawPass: 'pass123', role: 'student' },
                    { username: 'warden1', rawPass: 'pass123', role: 'warden' },
                    { username: 'staff1', rawPass: 'pass123', role: 'staff' },
                ];

                for (const u of usersToSeed) {
                    checkUser.get([u.username], async (err, row) => {
                        if (!row) {
                            const hashedList = await bcrypt.hash(u.rawPass, 10);
                            insertUser.run([u.username, hashedList, u.role]);
                            console.log(`Seeded user: ${u.username}`);
                        }
                    });
                }
            };
            
            seedUsers();
        });
    }
});

module.exports = db;
