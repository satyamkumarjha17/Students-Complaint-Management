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
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            SECRET_KEY,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    });
});

// 2. Complaints: Submit (Student only)
app.post('/api/complaints', authenticateToken, authorizeRoles('student'), (req, res) => {
    const { category, description } = req.body;
    const student_id = req.user.id;

    if (!category || !description) {
        return res.status(400).json({ error: 'Category and description required' });
    }

    const stmt = db.prepare('INSERT INTO complaints (student_id, category, description) VALUES (?, ?, ?)');
    stmt.run([student_id, category, description], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to submit complaint' });
        res.status(201).json({ message: 'Complaint submitted successfully', id: this.lastID });
    });
});

// 3. Complaints: View Complaints
// Student: Their own. Warden/Staff: All
app.get('/api/complaints', authenticateToken, (req, res) => {
    const userRole = req.user.role;
    
    let query = `
        SELECT c.*, u.username as student_username 
        FROM complaints c
        JOIN users u ON c.student_id = u.id
    `;
    let params = [];

    if (userRole === 'student') {
        query += ' WHERE c.student_id = ?';
        params.push(req.user.id);
    }
    
    query += ' ORDER BY c.created_at DESC';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    });
});

// 4. Complaints: Update status (Warden, Staff only)
app.put('/api/complaints/:id/status', authenticateToken, authorizeRoles('warden', 'staff'), (req, res) => {
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

    const query = 'UPDATE complaints SET status = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?';
    db.run(query, [status, resolved_at, id], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to update status' });
        if (this.changes === 0) return res.status(404).json({ error: 'Complaint not found' });
        res.json({ message: 'Status updated successfully' });
    });
});

// 5. Reports: (Staff, Warden only)
app.get('/api/reports', authenticateToken, authorizeRoles('staff', 'warden'), (req, res) => {
    const reportData = {};

    // 1. Complaints by Category
    db.all('SELECT category, COUNT(*) as count FROM complaints GROUP BY category', [], (err, categories) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        reportData.categories = categories;

        // 2. Average resolution time (very simplified: avg of diff in seconds for resolved/rejected)
        const resQuery = `
            SELECT 
                COUNT(*) as resolved_count,
                AVG(
                    CAST(strftime('%s', resolved_at) AS INTEGER) - 
                    CAST(strftime('%s', created_at) AS INTEGER)
                ) as avg_resolution_seconds
            FROM complaints
            WHERE resolved_at IS NOT NULL
        `;

        db.get(resQuery, [], (err, resolutionRow) => {
             if (err) return res.status(500).json({ error: 'Database error' });
             
             let avgHours = 0;
             if (resolutionRow.avg_resolution_seconds) {
                 avgHours = (resolutionRow.avg_resolution_seconds / 3600).toFixed(2);
             }
             
             reportData.resolution = {
                 resolved_count: resolutionRow.resolved_count,
                 avg_resolution_hours: avgHours
             };

             res.json(reportData);
        });
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
