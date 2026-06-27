# Worker Manager

<div align="center">

![Worker Manager](https://img.shields.io/badge/Worker_Manager-v1.0.0-6366f1?style=for-the-badge&logo=node.js&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20_LTS-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Armbian_%7C_Debian_%7C_Ubuntu-CE1126?style=for-the-badge&logo=linux&logoColor=white)
![Port](https://img.shields.io/badge/Port-8090-0ea5e9?style=for-the-badge)

Web UI untuk mengelola worker dan pengguna, dengan tema Dark Glassmorphism.

</div>

---

## ✨ Fitur

- 🔐 **Login** — Autentikasi aman dengan bcrypt
- 📊 **Dashboard** — Monitor worker secara real-time (Aktif / Nonaktif)
- ⚙️ **Pengaturan** — Tambah/hapus user dan worker (admin only)
- 🔔 **Notifikasi** — Toast notification dan konfirmasi hapus
- 📱 **Responsive** — Berjalan di desktop maupun mobile

---

## 🚀 Instalasi via `setup.sh`

### Persyaratan

| Kebutuhan | Keterangan |
|-----------|-----------|
| OS | Armbian / Debian / Ubuntu (ARM32, ARM64, x86_64) |
| Akses | `root` atau pengguna dengan `sudo` |
| Koneksi | Internet (untuk download Node.js & clone repo) |

---

### Langkah Instalasi

#### 1. Download `setup.sh`

Jika repository sudah ada di device:
```bash
# Masuk ke folder project
cd /opt/worker-manager
```

Atau download langsung dari GitHub:
```bash
wget -O setup.sh https://raw.githubusercontent.com/jacksatriadi-jpg/Worker-Manager/main/setup.sh
```

#### 2. Beri izin eksekusi

```bash
chmod +x setup.sh
```

#### 3. Jalankan setup

```bash
# Dengan sudo (direkomendasikan untuk Armbian)
sudo bash setup.sh

# Atau jika sudah login sebagai root
bash setup.sh
```

> ⏱️ Proses instalasi memerlukan waktu **3–10 menit** tergantung koneksi internet dan performa perangkat.

---

### Apa yang dilakukan `setup.sh`?

```
[1] Memeriksa hak akses (root / sudo)
[2] Mendeteksi OS dan arsitektur (ARM32 / ARM64 / x86_64)
[3] Update apt-get
[4] Install curl, git, wget, build-essential
[5] Install Node.js 20 LTS via NodeSource (ARM compatible)
[6] Clone repository dari GitHub ke /opt/worker-manager
    └── Jika sudah ada → git pull (update otomatis)
[7] Install npm packages (npm install --omit=dev)
[8] Membuat file .env (PORT, SESSION_SECRET)
[9] Membuat & mengaktifkan systemd service (autostart)
[10] Membuka port 8090 di UFW (jika tersedia)
[11] Menampilkan ringkasan hasil instalasi
```

---

## 🌐 Akses Aplikasi

Setelah setup selesai, buka browser dan akses:

| Tipe | URL |
|------|-----|
| Localhost | `http://localhost:8090` |
| LAN | `http://<IP-DEVICE>:8090` |

### Default Login

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `Bali@123` |

> ⚠️ **Segera ganti password admin** setelah login pertama melalui tab Pengaturan.

---

## 🛠️ Manajemen Service

Setelah instalasi, `worker-manager` berjalan sebagai **systemd service** dan akan **otomatis start** saat device reboot.

```bash
# Cek status
sudo systemctl status worker-manager

# Restart service
sudo systemctl restart worker-manager

# Stop service
sudo systemctl stop worker-manager

# Start service
sudo systemctl start worker-manager

# Lihat log real-time
sudo journalctl -u worker-manager -f

# Disable autostart
sudo systemctl disable worker-manager
```

---

## 📁 Struktur Project

```
/opt/worker-manager/
├── server.js          — Express server & REST API
├── db.js              — JSON database module
├── data.json          — File database (dibuat otomatis)
├── .env               — Konfigurasi environment (dibuat otomatis)
├── package.json       — NPM dependencies
├── setup.sh           — Script setup ini
├── Agent.txt          — Catatan untuk AI agent
├── README.md          — File ini
└── public/
    ├── index.html     — Single Page Application (SPA)
    └── index.css      — Styling Dark Glassmorphism
```

---

## 🔧 Update Manual

Untuk update ke versi terbaru, cukup jalankan setup.sh kembali:

```bash
sudo bash /opt/worker-manager/setup.sh
```

Script akan otomatis menjalankan `git pull` jika repository sudah ada.

---

## 🌐 REST API

| Method | Endpoint | Auth | Deskripsi |
|--------|----------|------|-----------|
| `POST` | `/api/login` | — | Login |
| `POST` | `/api/logout` | — | Logout |
| `GET` | `/api/me` | auth | Info sesi |
| `GET` | `/api/users` | admin | List users |
| `POST` | `/api/users` | admin | Tambah user |
| `DELETE` | `/api/users/:id` | admin | Hapus user |
| `GET` | `/api/workers` | auth | List workers |
| `POST` | `/api/workers` | admin | Tambah worker |
| `PATCH` | `/api/workers/:id/status` | auth | Update status |
| `DELETE` | `/api/workers/:id` | admin | Hapus worker |

---

## 🐛 Troubleshooting

### Node.js tidak terinstall di ARM

```bash
# Cek arsitektur
uname -m
# Output: armv7l (ARM32) atau aarch64 (ARM64) atau x86_64

# NodeSource mendukung semua arsitektur di atas
# Jika gagal, coba install manual:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Port 8090 tidak bisa diakses

```bash
# Cek apakah app berjalan
sudo systemctl status worker-manager

# Cek port terbuka
sudo ss -tlnp | grep 8090

# Buka port manual di UFW
sudo ufw allow 8090/tcp
sudo ufw reload
```

### Reset database

```bash
# Hapus data.json — akan dibuat ulang dengan akun admin default
sudo rm /opt/worker-manager/data.json
sudo systemctl restart worker-manager
```

### Lihat log error

```bash
sudo journalctl -u worker-manager -n 50 --no-pager
```

---

## 📋 Catatan Teknis

- Database menggunakan **JSON file** (`data.json`) — cocok untuk skala kecil
- Session menggunakan **cookie** berbasis `express-session`
- Password di-hash menggunakan **bcryptjs** (salt rounds: 10)
- `SESSION_SECRET` di-generate otomatis saat setup

---

<div align="center">

Worker Manager v1.0.0 | Port 8090 | Armbian / Debian / Ubuntu

</div>
