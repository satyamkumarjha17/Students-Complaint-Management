const API_URL = 'http://localhost:3001/api';

const appState = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user')),
    
    init() {
        this.bindEvents();
        if (this.token && this.user) {
            this.showDashboard();
        } else {
            this.showView('login');
        }
    },

    bindEvents() {
        document.getElementById('login-form').addEventListener('submit', this.handleLogin.bind(this));
        document.getElementById('logout-btn').addEventListener('click', this.logout.bind(this));
        document.getElementById('complaint-form').addEventListener('submit', this.submitComplaint.bind(this));
    },

    showView(viewName) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(`view-${viewName}`).classList.remove('hidden');
        
        const navbar = document.getElementById('navbar');
        if (viewName === 'login') {
            navbar.classList.add('hidden');
        } else {
            navbar.classList.remove('hidden');
            document.getElementById('user-info').textContent = `${this.user.username} (${this.user.role})`;
        }
    },

    showModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    },
    
    hideModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    },

    async handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('login-error');

        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Login failed');

            this.token = data.token;
            this.user = data.user;
            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));
            
            errorEl.classList.add('hidden');
            e.target.reset();
            this.showDashboard();
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.classList.remove('hidden');
        }
    },

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.showView('login');
    },

    showDashboard() {
        if (this.user.role === 'student') {
            this.showView('student');
            this.loadStudentComplaints();
        } else {
            this.showView('staff');
            this.loadStaffComplaints();
            this.loadReports();
        }
    },

    async fetchAuth(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`,
            ...options.headers
        };
        const res = await fetch(`${API_URL}${url}`, { ...options, headers });
        if (res.status === 401 || res.status === 403) {
            this.logout();
            throw new Error('Unauthorized');
        }
        return res;
    },

    // Student specific
    async loadStudentComplaints() {
        try {
            const res = await this.fetchAuth('/complaints');
            const complaints = await res.json();
            const container = document.getElementById('student-complaints-list');
            
            if (complaints.length === 0) {
                container.innerHTML = `<p class="text-muted" style="grid-column: 1/-1;">You haven't submitted any complaints yet.</p>`;
                return;
            }

            container.innerHTML = complaints.map(c => `
                <div class="complaint-card glassmorphism">
                    <div class="card-header">
                        <span class="card-category">${c.category}</span>
                        <span class="status-badge status-${c.status.replace(/\s+/g, '')}">${c.status}</span>
                    </div>
                    <p class="card-desc">${c.description}</p>
                    <div class="card-date">${new Date(c.created_at).toLocaleString()}</div>
                </div>
            `).join('');
        } catch (err) {
            console.error(err);
        }
    },

    async submitComplaint(e) {
        e.preventDefault();
        const category = document.getElementById('comp-category').value;
        const description = document.getElementById('comp-desc').value;

        try {
            const res = await this.fetchAuth('/complaints', {
                method: 'POST',
                body: JSON.stringify({ category, description })
            });
            
            if (res.ok) {
                this.hideModal('complaint-modal');
                e.target.reset();
                this.loadStudentComplaints();
            }
        } catch (err) {
            alert('Failed to submit complaint');
        }
    },

    // Staff/Warden specific
    async loadStaffComplaints() {
        try {
            const res = await this.fetchAuth('/complaints');
            const complaints = await res.json();
            const tbody = document.getElementById('staff-complaints-list');
            
            if (complaints.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No complaints found.</td></tr>`;
                return;
            }

            tbody.innerHTML = complaints.map(c => `
                <tr>
                    <td>#${c.id}</td>
                    <td>${c.student_username}</td>
                    <td>${c.category}</td>
                    <td><div style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${c.description}">${c.description}</div></td>
                    <td>${new Date(c.created_at).toLocaleDateString()}</td>
                    <td><span class="status-badge status-${c.status.replace(/\s+/g, '')}">${c.status}</span></td>
                    <td>
                        <select class="status-select" onchange="appState.updateStatus(${c.id}, this.value)">
                            <option value="Pending" ${c.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="In Progress" ${c.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                            <option value="Resolved" ${c.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                            <option value="Rejected" ${c.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </td>
                </tr>
            `).join('');
        } catch (err) {
            console.error(err);
        }
    },

    async updateStatus(id, newStatus) {
        try {
            const res = await this.fetchAuth(`/complaints/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) {
                this.loadStaffComplaints();
                this.loadReports();
            } else {
                alert('Failed to update status');
                this.loadStaffComplaints(); // reload to revert select
            }
        } catch (err) {
             alert('Error updating status');
        }
    },

    async loadReports() {
        try {
            const res = await this.fetchAuth('/reports');
            const data = await res.json();

            // Resolution
            const resEl = document.getElementById('stat-resolution-time');
            if (data.resolution.resolved_count > 0) {
                resEl.textContent = `${data.resolution.avg_resolution_hours} hrs`;
            } else {
                resEl.textContent = 'N/A';
            }

            // Categories
            const catList = document.getElementById('stat-categories-list');
            catList.innerHTML = data.categories.map(c => `
                <li>
                    <span>${c.category}</span>
                    <span style="font-weight:bold; color:var(--primary);">${c.count}</span>
                </li>
            `).join('');

        } catch (err) {
            console.error(err);
        }
    }
};

// Start app
document.addEventListener('DOMContentLoaded', () => {
    appState.init();
});
