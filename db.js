const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data.json');

function loadDB() {
    if (!fs.existsSync(DB_PATH)) {
        const initial = {
            users: [
                {
                    id: '1',
                    username: 'admin',
                    // bcrypt hash for "Bali@123"
                    password: '$2a$10$SFubiddOHvxUtEmuZ1PC/OJr6zLUbNEHbhChQOTC7SzsPQRI9IkXC',
                    role: 'admin',
                    createdAt: new Date().toISOString()
                }
            ],
            workers: []
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    }
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        return { users: [], workers: [] };
    }
}

function saveDB(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---- USERS ----
function getAllUsers() {
    const db = loadDB();
    return db.users || [];
}

function getUserByUsername(username) {
    const db = loadDB();
    return (db.users || []).find(u => u.username === username) || null;
}

function getUserById(id) {
    const db = loadDB();
    return (db.users || []).find(u => u.id === id) || null;
}

function createUser(username, hashedPassword, role) {
    const db = loadDB();
    const newUser = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        role: role || 'user',
        createdAt: new Date().toISOString()
    };
    db.users.push(newUser);
    saveDB(db);
    return newUser;
}

function deleteUser(id) {
    const db = loadDB();
    db.users = db.users.filter(u => u.id !== id);
    saveDB(db);
}

// ---- WORKERS ----
function getAllWorkers() {
    const db = loadDB();
    return db.workers || [];
}

function getWorkerById(id) {
    const db = loadDB();
    return (db.workers || []).find(w => w.id === id) || null;
}

function createWorker(name, workerLink, apiLink) {
    const db = loadDB();
    const newWorker = {
        id: Date.now().toString(),
        name,
        workerLink,
        apiLink,
        status: 'inactive',
        createdAt: new Date().toISOString()
    };
    db.workers.push(newWorker);
    saveDB(db);
    return newWorker;
}

function updateWorkerStatus(id, status) {
    const db = loadDB();
    const idx = db.workers.findIndex(w => w.id === id);
    if (idx !== -1) {
        db.workers[idx].status = status;
        db.workers[idx].updatedAt = new Date().toISOString();
        saveDB(db);
        return db.workers[idx];
    }
    return null;
}

function deleteWorker(id) {
    const db = loadDB();
    db.workers = db.workers.filter(w => w.id !== id);
    saveDB(db);
}

module.exports = {
    loadDB,
    saveDB,
    getAllUsers,
    getUserByUsername,
    getUserById,
    createUser,
    deleteUser,
    getAllWorkers,
    getWorkerById,
    createWorker,
    updateWorkerStatus,
    deleteWorker
};
