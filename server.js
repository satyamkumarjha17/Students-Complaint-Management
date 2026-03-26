const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { authenticateToken, authorizeRoles, SECRET_KEY } = require('./auth');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// === ROUTES ===

// 1. Auth: Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            SECRET_KEY,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 2. Complaints: Submit (Student only)
app.post('/api/complaints', authenticateToken, authorizeRoles('student'), async (req, res) => {
    const { category, description } = req.body;
    const student_id = req.user.id;

    if (!category || !description) {
        return res.status(400).json({ error: 'Category and description required' });
    }

    try {
        const result = await db.query(
            'INSERT INTO complaints (student_id, category, description) VALUES ($1, $2, $3) RETURNING id',
            [student_id, category, description]
        );
        res.status(201).json({ message: 'Complaint submitted successfully', id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to submit complaint' });
    }
});

// 3. Complaints: View Complaints
// Student: Their own. Warden/Staff: All
app.get('/api/complaints', authenticateToken, async (req, res) => {
    const userRole = req.user.role;
    
    let query = `
        SELECT c.*, u.username as student_username 
        FROM complaints c
        JOIN users u ON c.student_id = u.id
    `;
    let params = [];

    if (userRole === 'student') {
        query += ' WHERE c.student_id = $1';
        params.push(req.user.id);
    }
    
    query += ' ORDER BY c.created_at DESC';

    try {
        const { rows } = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 4. Complaints: Update status (Warden, Staff only)
app.put('/api/complaints/:id/status', authenticateToken, authorizeRoles('warden', 'staff'), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Pending', 'In Progress', 'Resolved', 'Rejected'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    let resolved_at = null;
    if (status === 'Resolved' || status === 'Rejected') {
        resolved_at = new Date().toISOString();
    }

    try {
        const query = 'UPDATE complaints SET status = $1, resolved_at = COALESCE($2, resolved_at) WHERE id = $3 RETURNING id';
        const result = await db.query(query, [status, resolved_at, id]);
        
        if (result.rowCount === 0) return res.status(404).json({ error: 'Complaint not found' });
        res.json({ message: 'Status updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// 5. Reports: (Staff, Warden only)
app.get('/api/reports', authenticateToken, authorizeRoles('staff', 'warden'), async (req, res) => {
    try {
        // 1. Complaints by Category
        const catRes = await db.query('SELECT category, COUNT(*) as count FROM complaints GROUP BY category');
        
        // 2. Average resolution time
        const resQuery = `
            SELECT 
                COUNT(*) as resolved_count,
                AVG(EXTRACT(EPOCH FROM resolved_at) - EXTRACT(EPOCH FROM created_at)) as avg_resolution_seconds
            FROM complaints
            WHERE resolved_at IS NOT NULL
        `;

        const resStats = await db.query(resQuery);
        
        let avgHours = 0;
        if (resStats.rows[0].avg_resolution_seconds) {
            avgHours = (resStats.rows[0].avg_resolution_seconds / 3600).toFixed(2);
        }

        res.json({
            categories: catRes.rows,
            resolution: {
                resolved_count: resStats.rows[0].resolved_count,
                avg_resolution_hours: avgHours
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
