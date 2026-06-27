'use strict';
/**
 * worker-control.js
 * Modul untuk manajemen GNU screen session.
 * Digunakan oleh server.js untuk menjalankan alur aktivasi/deaktivasi worker.
 *
 * Cara kerja:
 * - Semua interaksi dengan screen dilakukan via child_process.execFile
 *   (bukan exec/shell) untuk menghindari masalah escaping karakter.
 * - Output screen direkam ke file log di folder /logs/ via screen logging.
 * - waitForString() membaca log file secara bertahap (berbasis posisi byte).
 * - ANSI escape code dibersihkan sebelum pengecekan string.
 */

const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function execFileAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 15000, ...opts }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

/** Strip ANSI/VT100 escape codes agar pencocokan string lebih akurat */
function stripAnsi(str) {
    return str
        .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')   // CSI sequences
        .replace(/\x1B\][^\x07]*\x07/g, '')         // OSC sequences
        .replace(/\x1B[()][A-B0-9]/g, '')            // charset
        .replace(/\r/g, '');                          // CR
}

// ─── LOG FILE HELPERS ─────────────────────────────────────────────────────────

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(screenName) {
    return path.join(LOG_DIR, `screen-${screenName}.log`);
}

/** Kembalikan ukuran file saat ini (byte), atau 0 jika belum ada */
function getFilePosition(logFile) {
    try { return fs.statSync(logFile).size; } catch { return 0; }
}

/** Baca isi file mulai dari posisi byte tertentu, return string */
function readFileFromPos(logFile, pos) {
    try {
        const stat = fs.statSync(logFile);
        if (stat.size <= pos) return '';
        const fd  = fs.openSync(logFile, 'r');
        const buf = Buffer.alloc(stat.size - pos);
        fs.readSync(fd, buf, 0, buf.length, pos);
        fs.closeSync(fd);
        return buf.toString('utf8');
    } catch {
        return '';
    }
}

// ─── SCREEN MANAGEMENT ────────────────────────────────────────────────────────

/**
 * Periksa apakah screen session dengan nama tertentu sudah ada.
 */
async function screenExists(screenName) {
    return new Promise((resolve) => {
        execFile('screen', ['-ls'], (err, stdout) => {
            const output = stdout || '';
            const found  = output.split('\n').some(line => {
                const part = line.trim().split(/\s+/)[0] || '';
                return part.endsWith('.' + screenName);
            });
            resolve(found);
        });
    });
}

/**
 * Buat screen session baru dalam mode detached.
 * Tunggu 1 detik agar shell di dalamnya siap.
 */
async function createScreen(screenName) {
    ensureLogDir();
    await execFileAsync('screen', ['-dmS', screenName]);
    await sleep(1000);
}

/**
 * Aktifkan logging pada screen session yang sudah ada.
 * File log akan di-truncate terlebih dahulu.
 */
async function setupLogging(screenName, logFile) {
    ensureLogDir();
    // Truncate log file
    fs.writeFileSync(logFile, '');

    // Set logfile path
    await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'logfile', logFile]);
    await sleep(100);

    // Off dulu (reset state) baru on
    try {
        await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'log', 'off']);
    } catch {}
    await sleep(100);
    await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'log', 'on']);
    await sleep(300);
}

/**
 * Kirim command ke screen session (ditambah newline di akhir).
 * Menggunakan execFile untuk menghindari shell escaping.
 */
async function sendCommand(screenName, command) {
    await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'stuff', command + '\n']);
}

/**
 * Kirim CTRL-C ke screen session.
 */
async function sendCtrlC(screenName) {
    await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'stuff', '\x03']);
}

/**
 * Detach dari screen session.
 */
async function detachScreen(screenName) {
    try {
        await execFileAsync('screen', ['-S', screenName, '-d']);
    } catch {}
}

// ─── STRING DETECTION ─────────────────────────────────────────────────────────

/**
 * Tunggu hingga string tertentu muncul di log file, mulai dari posisi byte `startPos`.
 *
 * @param {string} logFile     - Path ke file log screen
 * @param {string} targetStr   - String yang ditunggu
 * @param {number} startPos    - Posisi byte awal pembacaan
 * @param {number} timeoutMs   - Timeout dalam ms (default 30000)
 * @returns {Promise<number>}  - Posisi byte baru setelah string ditemukan
 * @throws {Error}             - 'Timeout' atau 'Exception in thread'
 */
async function waitForString(logFile, targetStr, startPos, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;

        function check() {
            if (Date.now() > deadline) {
                return reject(new Error('Timeout'));
            }
            try {
                const stat = fs.statSync(logFile);
                if (stat.size > startPos) {
                    const fd  = fs.openSync(logFile, 'r');
                    const buf = Buffer.alloc(stat.size - startPos);
                    fs.readSync(fd, buf, 0, buf.length, startPos);
                    fs.closeSync(fd);

                    const raw     = buf.toString('utf8');
                    const content = stripAnsi(raw);

                    if (content.includes('Exception in thread')) {
                        return reject(new Error('Exception in thread'));
                    }
                    if (content.includes(targetStr)) {
                        return resolve(stat.size);
                    }
                }
            } catch {}
            setTimeout(check, 500);
        }

        check();
    });
}

module.exports = {
    sleep,
    getLogFile,
    getFilePosition,
    readFileFromPos,
    stripAnsi,
    screenExists,
    createScreen,
    setupLogging,
    sendCommand,
    sendCtrlC,
    detachScreen,
    waitForString,
};
