'use strict';
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const http    = require('http');
const https   = require('https');
const path    = require('path');
const db      = require('./db');
const wc      = require('./worker-control');

const app  = express();
const PORT = process.env.PORT || 8090;

// ─── IN-MEMORY STATE ──────────────────────────────────────────────────────────
// Map<workerId, intervalId>   — interval polling api per worker
const activePollIntervals = new Map();
// Map<workerId, boolean>      — lock agar tidak ada double activation
const workerLocks = new Map();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'worker-manager-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin')
        return res.status(403).json({ error: 'Forbidden: Admin only' });
    next();
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** GET apiLink dan kembalikan object JSON, atau null jika gagal */
async function checkApiLink(apiLink) {
    return new Promise((resolve) => {
        try {
            const url    = new URL(apiLink);
            const client = url.protocol === 'https:' ? https : http;
            const req    = client.get(apiLink, { timeout: 8000 }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch { resolve(null); }
                });
            });
            req.on('error',   () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch {
            resolve(null);
        }
    });
}

/** Hentikan interval polling untuk worker tertentu */
function stopPollInterval(workerId) {
    if (activePollIntervals.has(workerId)) {
        clearInterval(activePollIntervals.get(workerId));
        activePollIntervals.delete(workerId);
    }
}

// ─── POLLING API (per worker) ─────────────────────────────────────────────────
/**
 * Mulai polling Link API setiap 5 detik untuk worker tertentu.
 *
 * Bekerja untuk SEMUA status worker (termasuk 'inactive') sehingga
 * worker yang dijalankan secara manual (bukan via web) tetap terdeteksi.
 *
 * Transisi status:
 *   API BOOT        → 'ready'        (baru saja start, siap diakses)
 *   API PROCESSING  → 'processing'   (sedang dipakai)
 *   API FINISH      → 'finished'     (selesai, siap digunakan lagi)
 *   API IDLE        → 'deactivating' → tunggu 30s → deactivateWorker()
 *                     (hanya jika status saat ini BUKAN 'inactive')
 *
 * Juga memantau log screen untuk "Exception in thread" (status non-inactive).
 */
function startApiPolling(workerId, worker) {
    stopPollInterval(workerId);

    const logFile    = worker.screenName ? wc.getLogFile(worker.screenName) : null;
    let   lastLogPos = logFile ? wc.getFilePosition(logFile) : 0;

    const intervalId = setInterval(async () => {
        // Jika sedang diproses (aktivasi/deaktivasi), skip
        if (workerLocks.get(workerId)) return;

        const current = db.getWorkerById(workerId);
        if (!current) {
            // Worker sudah dihapus, hentikan polling
            stopPollInterval(workerId);
            return;
        }

        // Cek log screen untuk 'Exception in thread' (hanya saat aktif)
        if (logFile && current.status !== 'inactive') {
            try {
                const newLog = wc.readFileFromPos(logFile, lastLogPos);
                if (newLog.length > 0) {
                    lastLogPos += Buffer.byteLength(newLog, 'utf8');
                    if (wc.stripAnsi(newLog).includes('Exception in thread')) {
                        console.log(`[Worker ${workerId}] Exception in thread detected`);
                        db.updateWorkerStatus(workerId, 'inactive');
                        // Tetap lanjutkan polling (agar deteksi manual restart)
                        return;
                    }
                }
            } catch {}
        }

        // Cek Link API
        if (!current.apiLink) return;
        try {
            const resp = await checkApiLink(current.apiLink);
            if (!resp) return; // API tidak bisa dijangkau, coba lagi nanti

            const apiStatus = resp.status;
            const curStatus = current.status;

            if (apiStatus === 'BOOT') {
                // Server baru saja start → status 'ready'
                if (curStatus !== 'ready') {
                    console.log(`[Worker ${workerId}] API BOOT detected (cur: ${curStatus}) → ready`);
                    db.updateWorkerStatus(workerId, 'ready');
                }

            } else if (apiStatus === 'PROCESSING') {
                // Sedang dipakai → 'processing'
                if (curStatus !== 'processing') {
                    console.log(`[Worker ${workerId}] API PROCESSING detected (cur: ${curStatus}) → processing`);
                    db.updateWorkerStatus(workerId, 'processing');
                }

            } else if (apiStatus === 'FINISH') {
                if (curStatus !== 'finished') {
                    console.log(`[Worker ${workerId}] API FINISH detected (cur: ${curStatus}) → finished`);
                    db.updateWorkerStatus(workerId, 'finished');
                }

            } else if (apiStatus === 'IDLE') {
                if (curStatus === 'inactive') {
                    // Sudah nonaktif, abaikan IDLE
                    return;
                }
                if (curStatus !== 'deactivating') {
                    console.log(`[Worker ${workerId}] API IDLE detected (cur: ${curStatus}) → deactivating`);
                    db.updateWorkerStatus(workerId, 'deactivating');
                    stopPollInterval(workerId);
                    // Tunggu 30 detik lalu jalankan deactivation
                    setTimeout(() => {
                        const fresh = db.getWorkerById(workerId);
                        if (fresh && fresh.status === 'deactivating') {
                            deactivateWorker(workerId, fresh).catch(console.error);
                        }
                    }, 30000);
                }
            }
        } catch (e) {
            console.error(`[Worker ${workerId}] Poll error:`, e.message);
        }
    }, 5000);

    activePollIntervals.set(workerId, intervalId);
}

// ─── ACTIVATION FLOW ──────────────────────────────────────────────────────────
/**
 * Alur aktivasi worker (async, tidak block HTTP response):
 * 1. Set status → 'preparing'
 * 2. Cek/buat screen session
 * 3. Setup logging
 * 4. Kirim gcloudCommand → tunggu @cloudshell:~$ (timeout 30s, retry 3x)
 * 5. Kirim cloudflareCommand → tunggu @cloudshell:~$ (timeout 60s)
 * 6. Kirim serverCommand
 * 7. Tunggu 5 detik → cek Link API
 * 8. Set status 'ready' → detach screen → mulai polling
 */
async function activateWorker(workerId, worker) {
    workerLocks.set(workerId, true);
    console.log(`[Worker ${workerId}] Activation started`);

    try {
        const { screenName, gcloudCommand, cloudflareCommand, serverCommand, apiLink } = worker;

        if (!screenName) throw new Error('screenName tidak dikonfigurasi');

        db.updateWorkerStatus(workerId, 'preparing');
        const logFile = wc.getLogFile(screenName);

        // Cek / buat screen
        const exists = await wc.screenExists(screenName);
        if (!exists) {
            console.log(`[Worker ${workerId}] Creating screen: ${screenName}`);
            await wc.createScreen(screenName);
        } else {
            console.log(`[Worker ${workerId}] Screen exists: ${screenName}`);
        }

        // Setup logging
        await wc.setupLogging(screenName, logFile);
        await wc.sleep(500);

        // ── Step 1: gcloud command (retry max 3x, timeout 30s each) ──
        if (gcloudCommand) {
            let gcloudOk = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                const pos = wc.getFilePosition(logFile);
                console.log(`[Worker ${workerId}] gcloud attempt ${attempt}`);
                await wc.sendCommand(screenName, gcloudCommand);
                try {
                    await wc.waitForString(logFile, '@cloudshell:~$', pos, 30000);
                    gcloudOk = true;
                    break;
                } catch (e) {
                    if (e.message === 'Exception in thread') throw e;
                    console.warn(`[Worker ${workerId}] gcloud timeout attempt ${attempt}`);
                }
            }
            if (!gcloudOk) throw new Error('gcloud gagal setelah 3x percobaan');
        }

        // ── Step 2: cloudflare command (timeout 60s) ──
        if (cloudflareCommand) {
            const pos = wc.getFilePosition(logFile);
            console.log(`[Worker ${workerId}] Sending cloudflare command`);
            await wc.sendCommand(screenName, cloudflareCommand);
            await wc.waitForString(logFile, '@cloudshell:~$', pos, 60000);
        }

        // ── Step 3: server command ──
        if (serverCommand) {
            console.log(`[Worker ${workerId}] Sending server command`);
            await wc.sendCommand(screenName, serverCommand);
        }

        // ── Step 4: Tunggu 5 detik lalu cek API ──
        await wc.sleep(5000);
        let newStatus = 'ready';
        if (apiLink) {
            const resp = await checkApiLink(apiLink);
            if (resp) {
                if      (resp.status === 'BOOT')       newStatus = 'ready';
                else if (resp.status === 'PROCESSING') newStatus = 'processing';
                else if (resp.status === 'FINISH')     newStatus = 'finished';
                else if (resp.status === 'IDLE')       newStatus = 'deactivating';
            }
        }

        // ── Step 5: Update status, detach, mulai polling ──
        db.updateWorkerStatus(workerId, newStatus);
        await wc.detachScreen(screenName);
        console.log(`[Worker ${workerId}] Activation done, status: ${newStatus}`);

        // Ambil worker terbaru (mungkin ada update fields selama proses)
        const freshWorker = db.getWorkerById(workerId);
        if (freshWorker && newStatus !== 'deactivating' && newStatus !== 'inactive') {
            startApiPolling(workerId, freshWorker);
        } else if (newStatus === 'deactivating') {
            // Langsung jadwalkan deaktivasi
            setTimeout(() => {
                const w = db.getWorkerById(workerId);
                if (w && w.status === 'deactivating') {
                    deactivateWorker(workerId, w).catch(console.error);
                }
            }, 30000);
        }

    } catch (e) {
        console.error(`[Worker ${workerId}] Activation error:`, e.message);
        db.updateWorkerStatus(workerId, 'inactive');
        try { await wc.detachScreen(worker.screenName); } catch {}
    } finally {
        workerLocks.set(workerId, false);
    }
}

// ─── DEACTIVATION FLOW ────────────────────────────────────────────────────────
/**
 * Alur deaktivasi:
 * 1. Hentikan polling
 * 2. Masuk screen → CTRL-C (loop max 5x) → tunggu @cloudshell:~$
 * 3. Kirim 'logout' → detach
 * 4. Set status → 'inactive'
 */
async function deactivateWorker(workerId, worker) {
    if (!worker) worker = db.getWorkerById(workerId);
    if (!worker) return;

    workerLocks.set(workerId, true);
    console.log(`[Worker ${workerId}] Deactivation started`);

    try {
        stopPollInterval(workerId);

        const { screenName } = worker;

        if (screenName && await wc.screenExists(screenName)) {
            const logFile = wc.getLogFile(screenName);
            await wc.setupLogging(screenName, logFile);
            await wc.sleep(500);

            // Kirim CTRL-C sampai dapat prompt (max 5x)
            let gotPrompt = false;
            for (let i = 0; i < 5; i++) {
                const pos = wc.getFilePosition(logFile);
                await wc.sendCtrlC(screenName);
                try {
                    await wc.waitForString(logFile, '@cloudshell:~$', pos, 10000);
                    gotPrompt = true;
                    break;
                } catch {}
            }

            if (gotPrompt) {
                console.log(`[Worker ${workerId}] Got prompt, sending logout`);
                await wc.sendCommand(screenName, 'logout');
                await wc.sleep(2000);
            }

            await wc.detachScreen(screenName);
        }

        db.updateWorkerStatus(workerId, 'inactive');
        console.log(`[Worker ${workerId}] Deactivation done`);

    } catch (e) {
        console.error(`[Worker ${workerId}] Deactivation error:`, e.message);
        db.updateWorkerStatus(workerId, 'inactive');
    } finally {
        workerLocks.set(workerId, false);
        // Restart polling setelah deaktivasi selesai, agar bisa deteksi
        // bila user menjalankan worker ini secara manual di kemudian hari
        const freshWorker = db.getWorkerById(workerId);
        if (freshWorker && freshWorker.apiLink) {
            startApiPolling(workerId, freshWorker);
            console.log(`[Worker ${workerId}] Polling restarted after deactivation`);
        }
    }
}

// ─── STARTUP RECOVERY ────────────────────────────────────────────────────────
/**
 * Saat server restart:
 * - Status 'preparing' / 'deactivating' → reset ke 'inactive' (transient state)
 * - Semua worker yang punya apiLink → mulai polling (termasuk yg 'inactive')
 *   sehingga worker yang dijalankan manual tetap terdeteksi.
 */
function recoverWorkerStates() {
    const workers = db.getAllWorkers();
    for (const w of workers) {
        // Reset transient states
        if (['preparing', 'deactivating'].includes(w.status)) {
            db.updateWorkerStatus(w.id, 'inactive');
            console.log(`[Recovery] Worker ${w.id} (${w.name}) reset to inactive`);
        }
        // Mulai polling untuk semua worker yang punya apiLink
        if (w.apiLink) {
            const fresh = db.getWorkerById(w.id); // ambil setelah reset
            startApiPolling(w.id, fresh);
            console.log(`[Recovery] Worker ${w.id} (${w.name}) polling started (status: ${fresh.status})`);
        }
    }
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: 'Username dan password wajib diisi' });

    const user = db.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Username atau password salah' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Username atau password salah' });

    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ success: true, user: { username: user.username, role: user.role } });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user: req.session.user });
});

// ─── USER ROUTES ──────────────────────────────────────────────────────────────

app.get('/api/users', requireAdmin, (req, res) => {
    const users = db.getAllUsers().map(u => ({
        id: u.id, username: u.username, role: u.role, createdAt: u.createdAt
    }));
    res.json({ users });
});

app.post('/api/users', requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role)
        return res.status(400).json({ error: 'Username, password, dan role wajib diisi' });

    if (db.getUserByUsername(username))
        return res.status(409).json({ error: 'Username sudah digunakan' });

    const hashed = await bcrypt.hash(password, 10);
    const user   = db.createUser(username, hashed, role);
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
    if (req.session.user.id === req.params.id)
        return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
    db.deleteUser(req.params.id);
    res.json({ success: true });
});

// ─── WORKER ROUTES ────────────────────────────────────────────────────────────

app.get('/api/workers', requireAuth, (req, res) => {
    res.json({ workers: db.getAllWorkers() });
});

// Tambah worker
app.post('/api/workers', requireAdmin, (req, res) => {
    const { name, workerLink, apiLink, screenName, gcloudCommand, cloudflareCommand, serverCommand } = req.body;
    if (!name || !workerLink || !apiLink)
        return res.status(400).json({ error: 'Nama, link worker, dan link API wajib diisi' });

    const worker = db.createWorker({ name, workerLink, apiLink, screenName, gcloudCommand, cloudflareCommand, serverCommand });
    res.json({ success: true, worker });
});

// Edit worker (admin only)
app.put('/api/workers/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { name, workerLink, apiLink, screenName, gcloudCommand, cloudflareCommand, serverCommand } = req.body;

    if (!name || !workerLink || !apiLink)
        return res.status(400).json({ error: 'Nama, link worker, dan link API wajib diisi' });

    const worker = db.updateWorkerFields(id, {
        name, workerLink, apiLink,
        screenName:        screenName        || '',
        gcloudCommand:     gcloudCommand     || '',
        cloudflareCommand: cloudflareCommand || '',
        serverCommand:     serverCommand     || '',
    });

    if (!worker) return res.status(404).json({ error: 'Worker tidak ditemukan' });
    res.json({ success: true, worker });
});

// Aktivasi worker
app.post('/api/workers/:id/activate', requireAuth, (req, res) => {
    const { id } = req.params;
    const worker = db.getWorkerById(id);
    if (!worker) return res.status(404).json({ error: 'Worker tidak ditemukan' });
    if (workerLocks.get(id)) return res.status(409).json({ error: 'Worker sedang dalam proses' });
    if (worker.status !== 'inactive') return res.status(400).json({ error: 'Worker harus dalam status Nonaktif untuk diaktifkan' });

    res.json({ success: true, message: 'Aktivasi dimulai' });
    activateWorker(id, worker).catch(console.error);
});

// Hentikan worker (deactivation flow)
app.post('/api/workers/:id/deactivate', requireAuth, (req, res) => {
    const { id } = req.params;
    const worker = db.getWorkerById(id);
    if (!worker) return res.status(404).json({ error: 'Worker tidak ditemukan' });
    if (workerLocks.get(id)) return res.status(409).json({ error: 'Worker sedang dalam proses' });

    res.json({ success: true, message: 'Deaktivasi dimulai' });
    deactivateWorker(id, worker).catch(console.error);
});

// Hapus worker
app.delete('/api/workers/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    stopPollInterval(id);
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
    recoverWorkerStates();
});
