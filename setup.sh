#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Worker Manager — Setup Script
#  Compatible: Armbian, Debian, Ubuntu (ARM32 / ARM64 / x86_64)
#  Author: Worker Manager Project
#  Version: 1.0.0
# ═══════════════════════════════════════════════════════════════════

set -e  # Exit on any error

# ── KONFIGURASI ──────────────────────────────────────────────────────
GITHUB_REPO="https://github.com/jacksatriadi-jpg/Worker-Manager.git"
APP_DIR="/opt/worker-manager"
APP_PORT="8090"
SERVICE_NAME="worker-manager"
NODE_VERSION="18"          # Minimum LTS — v18.x, v20.x, v22.x semuanya compatible
APP_USER="$(whoami)"

# ── WARNA ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── HELPER FUNCTIONS ──────────────────────────────────────────────────
log()     { echo -e "${GREEN}[✓]${NC} $1"; }
info()    { echo -e "${BLUE}[i]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}\n"; }

# ── BANNER ────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
cat << 'EOF'
 __        __         _              __  __
 \ \      / /__  _ __| | _____ _ __|  \/  | __ _ _ __
  \ \ /\ / / _ \| '__| |/ / _ \ '__| |\/| |/ _` | '__|
   \ V  V / (_) | |  |   <  __/ |  | |  | | (_| | |
    \_/\_/ \___/|_|  |_|\_\___|_|  |_|  |_|\__,_|_|
EOF
echo -e "${NC}"
echo -e "${BOLD}  Worker Manager Setup Script v1.0.0${NC}"
echo -e "  Target: ${CYAN}$APP_DIR${NC} | Port: ${CYAN}$APP_PORT${NC}"
echo ""

# ── CEK ROOT / SUDO ───────────────────────────────────────────────────
section "Memeriksa Hak Akses"
if [ "$EUID" -ne 0 ]; then
    warn "Script tidak dijalankan sebagai root."
    warn "Beberapa perintah mungkin memerlukan sudo."
    SUDO="sudo"
else
    log "Berjalan sebagai root."
    SUDO=""
fi

# ── CEK SISTEM OPERASI ───────────────────────────────────────────────
section "Memeriksa Sistem Operasi"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    info "OS: ${PRETTY_NAME}"
    info "Arsitektur: $(uname -m)"
else
    warn "Tidak dapat mendeteksi OS. Melanjutkan dengan asumsi Debian/Ubuntu."
fi

# Pastikan ini Debian/Ubuntu based (apt)
if ! command -v apt-get &> /dev/null; then
    error "apt-get tidak ditemukan. Script ini hanya untuk Debian/Ubuntu/Armbian."
fi
log "Package manager apt-get ditemukan."

# ── UPDATE SISTEM ────────────────────────────────────────────────────
section "Update System Packages"
info "Menjalankan apt-get update..."
$SUDO apt-get update -qq
log "System packages diperbarui."

# ── INSTALL DEPENDENCIES ──────────────────────────────────────────────
section "Install Dependencies Dasar"

# Install curl, git, wget, build-essential
DEPS="curl git wget build-essential ca-certificates gnupg"
info "Menginstall: $DEPS"
$SUDO apt-get install -y -qq $DEPS
log "Dependencies dasar berhasil diinstall."

# ── INSTALL NODE.JS ───────────────────────────────────────────────────
section "Install Node.js $NODE_VERSION LTS"

if command -v node &> /dev/null; then
    CURRENT_NODE=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ] 2>/dev/null; then
        log "Node.js $(node -v) sudah terinstall dan memenuhi syarat (minimum v${NODE_VERSION}). Skip install."
    else
        warn "Node.js $(node -v) ditemukan tapi versi kurang dari v${NODE_VERSION}. Akan diupgrade."
        INSTALL_NODE=true
    fi
else
    info "Node.js belum terinstall. Menginstall v${NODE_VERSION} LTS..."
    INSTALL_NODE=true
fi

if [ "${INSTALL_NODE}" = true ]; then
    # Gunakan NodeSource repository (mendukung ARM32/ARM64)
    info "Menambahkan NodeSource repository untuk Node.js ${NODE_VERSION}..."

    # Hapus repo lama jika ada
    $SUDO rm -f /etc/apt/sources.list.d/nodesource.list
    $SUDO rm -f /usr/share/keyrings/nodesource.gpg

    # Download dan jalankan setup script NodeSource
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | $SUDO -E bash -

    $SUDO apt-get install -y nodejs
    log "Node.js $(node -v) berhasil diinstall."
fi

# Verifikasi npm
if ! command -v npm &> /dev/null; then
    error "npm tidak ditemukan setelah instalasi Node.js."
fi
log "npm $(npm -v) tersedia."

# ── CLONE / UPDATE REPOSITORY ────────────────────────────────────────
section "Clone / Update Repository"

if [ -d "$APP_DIR" ]; then
    warn "Direktori $APP_DIR sudah ada."
    if [ -d "$APP_DIR/.git" ]; then
        info "Repository ditemukan. Menjalankan git pull untuk update..."
        cd "$APP_DIR"
        git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || warn "git pull gagal, menggunakan kode yang ada."
        log "Repository diperbarui."
    else
        warn "$APP_DIR ada tapi bukan git repo. Melewati clone."
    fi
else
    info "Cloning dari ${GITHUB_REPO}..."
    $SUDO git clone "$GITHUB_REPO" "$APP_DIR"

    # Beri kepemilikan ke user yang menjalankan
    if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
        $SUDO chown -R "$SUDO_USER:$SUDO_USER" "$APP_DIR"
    fi
    log "Repository berhasil di-clone ke $APP_DIR."
fi

cd "$APP_DIR"

# ── INSTALL NPM PACKAGES ──────────────────────────────────────────────
section "Install NPM Packages"
info "Menjalankan npm install..."
npm install --omit=dev
log "NPM packages berhasil diinstall."

# ── BUAT FILE .env (jika belum ada) ───────────────────────────────────
section "Konfigurasi Environment"
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    info "Membuat file .env..."
    cat > "$ENV_FILE" << EOF
# Worker Manager Environment Configuration
PORT=$APP_PORT
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1)
NODE_ENV=production
EOF
    log "File .env dibuat di $ENV_FILE"
else
    info "File .env sudah ada, tidak ditimpa."
fi

# Update server.js agar baca .env jika ada
# (server.js sudah menggunakan process.env.PORT)
info "Port yang akan digunakan: $APP_PORT"

# ── SETUP SYSTEMD SERVICE ─────────────────────────────────────────────
section "Setup Systemd Service"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if command -v systemctl &> /dev/null; then
    info "Membuat systemd service: ${SERVICE_NAME}"

    # Tentukan user untuk service
    if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
        RUN_AS="$SUDO_USER"
    elif [ "$EUID" -eq 0 ]; then
        RUN_AS="root"
    else
        RUN_AS="$APP_USER"
    fi

    $SUDO tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Worker Manager Web UI
Documentation=https://github.com/jacksatriadi-jpg/Worker-Manager
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_AS}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=on-failure
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=${SERVICE_NAME}
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
EnvironmentFile=-${APP_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

    $SUDO systemctl daemon-reload
    $SUDO systemctl enable "$SERVICE_NAME"
    $SUDO systemctl restart "$SERVICE_NAME" 2>/dev/null || $SUDO systemctl start "$SERVICE_NAME"

    sleep 2
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log "Service '${SERVICE_NAME}' berjalan dan diset autostart."
    else
        warn "Service mungkin belum berjalan. Cek: sudo systemctl status $SERVICE_NAME"
    fi
else
    warn "systemctl tidak ditemukan. Service tidak dibuat."
    warn "Jalankan manual: cd $APP_DIR && node server.js"
fi

# ── KONFIGURASI FIREWALL (opsional) ────────────────────────────────────
section "Konfigurasi Firewall (opsional)"
if command -v ufw &> /dev/null; then
    info "UFW ditemukan. Membuka port $APP_PORT..."
    $SUDO ufw allow "$APP_PORT/tcp" 2>/dev/null && log "Port $APP_PORT dibuka di UFW." || warn "Gagal membuka port UFW."
else
    info "UFW tidak terinstall. Lewati konfigurasi firewall."
    info "Pastikan port $APP_PORT terbuka di firewall/router Anda secara manual."
fi

# ── SELESAI ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅  Setup Selesai!${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""

# Cari IP lokal
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "IP-DEVICE")

echo -e "  📁  Direktori  : ${CYAN}$APP_DIR${NC}"
echo -e "  🚪  Port       : ${CYAN}$APP_PORT${NC}"
echo -e "  🌐  Akses dari : ${CYAN}http://localhost:${APP_PORT}${NC}"
echo -e "  🌐  LAN        : ${CYAN}http://${LOCAL_IP}:${APP_PORT}${NC}"
echo ""
echo -e "  👤  Login      : ${BOLD}admin${NC} / ${BOLD}Bali@123${NC}"
echo ""
echo -e "  📋  Perintah berguna:"
echo -e "      ${YELLOW}sudo systemctl status $SERVICE_NAME${NC}   # Cek status"
echo -e "      ${YELLOW}sudo systemctl restart $SERVICE_NAME${NC}  # Restart"
echo -e "      ${YELLOW}sudo systemctl stop $SERVICE_NAME${NC}     # Stop"
echo -e "      ${YELLOW}sudo journalctl -u $SERVICE_NAME -f${NC}   # Lihat log"
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
