const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8090;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'worker-manager-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin only' });
    }
    next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// POST /api/login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }
    const user = db.getUserByUsername(username);
    if (!user) {
        return res.status(401).json({ error: 'Username atau password salah' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
        return res.status(401).json({ error: 'Username atau password salah' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    return res.json({ success: true, user: { username: user.username, role: user.role } });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// GET /api/me
app.get('/api/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ user: req.session.user });
});

// ─── USER ROUTES ──────────────────────────────────────────────────────────────

// GET /api/users
app.get('/api/users', requireAdmin, (req, res) => {
    const users = db.getAllUsers().map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt
    }));
    res.json({ users });
});

// POST /api/users
app.post('/api/users', requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Username, password, dan role wajib diisi' });
    }
    const existing = db.getUserByUsername(username);
    if (existing) {
        return res.status(409).json({ error: 'Username sudah digunakan' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = db.createUser(username, hashed, role);
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
});

// DELETE /api/users/:id
app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    // Prevent deleting self
    if (req.session.user.id === id) {
        return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
    }
    db.deleteUser(id);
    res.json({ success: true });
});

// ─── WORKER ROUTES ────────────────────────────────────────────────────────────

// GET /api/workers
app.get('/api/workers', requireAuth, (req, res) => {
    const workers = db.getAllWorkers();
    res.json({ workers });
});

// POST /api/workers
app.post('/api/workers', requireAdmin, (req, res) => {
    const { name, workerLink, apiLink } = req.body;
    if (!name || !workerLink || !apiLink) {
        return res.status(400).json({ error: 'Nama worker, link worker, dan link API wajib diisi' });
    }
    const worker = db.createWorker(name, workerLink, apiLink);
    res.json({ success: true, worker });
});

// PATCH /api/workers/:id/status
app.patch('/api/workers/:id/status', requireAuth, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ error: 'Status tidak valid' });
    }
    const worker = db.updateWorkerStatus(id, status);
    if (!worker) {
        return res.status(404).json({ error: 'Worker tidak ditemukan' });
    }
    res.json({ success: true, worker });
});

// DELETE /api/workers/:id
app.delete('/api/workers/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    db.deleteWorker(id);
    res.json({ success: true });
});

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Worker Manager berjalan di http://localhost:${PORT}`);
    console.log(`   Default login: admin / Bali@123`);
    console.log(`   Port: ${PORT}\n`);
});
