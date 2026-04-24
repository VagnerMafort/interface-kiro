#!/bin/bash
# ═══════════════════════════════════════════════════
# Kiro Mobile Bridge - Setup Completo no VPS
# Instala desktop virtual + VNC + Kiro + Bridge
# Testado em: Ubuntu 22.04 / Debian 12
# ═══════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║  Kiro Mobile Bridge - Setup VPS Completo     ║"
echo "║  Desktop Virtual + Kiro + Interface Mobile   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Configurações
VNC_PASSWORD="${VNC_PASSWORD:-kiro123}"
VNC_PORT="${VNC_PORT:-5901}"
VNC_DISPLAY=":1"
VNC_RESOLUTION="${VNC_RESOLUTION:-1920x1080}"
APP_PORT="${APP_PORT:-9090}"

export DEBIAN_FRONTEND=noninteractive

# ─── 1. Atualizar sistema ────────────────────────
echo ""
echo "[1/7] Atualizando sistema..."
apt update -qq && apt upgrade -y -qq

# ─── 2. Instalar desktop XFCE (leve) ─────────────
echo ""
echo "[2/7] Instalando desktop virtual XFCE..."
apt install -y -qq \
    xfce4 \
    xfce4-terminal \
    dbus-x11 \
    x11-xserver-utils \
    xfonts-base \
    xfonts-100dpi \
    xfonts-75dpi \
    fonts-liberation \
    fonts-noto-color-emoji \
    mesa-utils \
    libgl1-mesa-dri \
    2>/dev/null

echo "  -> XFCE instalado"

# ─── 3. Instalar TigerVNC Server ─────────────────
echo ""
echo "[3/7] Instalando TigerVNC Server..."
apt install -y -qq tigervnc-standalone-server tigervnc-common xvfb 2>/dev/null

# Configurar senha VNC
mkdir -p ~/.vnc
echo "$VNC_PASSWORD" | vncpasswd -f > ~/.vnc/passwd
chmod 600 ~/.vnc/passwd

# Criar xstartup
cat > ~/.vnc/xstartup << 'XSTARTUP'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11
export DISPLAY=:1

# Inicia dbus
eval $(dbus-launch --sh-syntax --exit-with-session)
export DBUS_SESSION_BUS_ADDRESS

# Inicia XFCE e espera
exec startxfce4
XSTARTUP
chmod +x ~/.vnc/xstartup

# Config do VNC
cat > ~/.vnc/config << VNCCONFIG
geometry=$VNC_RESOLUTION
depth=24
localhost=no
VNCCONFIG

echo "  -> TigerVNC configurado"

# ─── 4. Instalar Kiro ────────────────────────────
echo ""
echo "[4/7] Instalando Kiro IDE..."

# Dependências do Kiro/Electron
apt install -y -qq \
    wget \
    curl \
    gpg \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    libxshmfence1 \
    2>/dev/null

# Baixa e instala o Kiro (ajuste a URL quando disponível)
echo "  [INFO] O Kiro precisa ser instalado manualmente."
echo "  Baixe o .deb em: https://kiro.dev/download"
echo "  Depois rode: dpkg -i kiro_*.deb && apt -f install -y"
echo ""
echo "  Por enquanto, instalando VS Code como alternativa..."

# Instala VS Code como fallback (mesma base do Kiro)
if ! command -v code &>/dev/null; then
    wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /tmp/packages.microsoft.gpg
    install -D -o root -g root -m 644 /tmp/packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list
    apt update -qq
    apt install -y -qq code 2>/dev/null
    echo "  -> VS Code instalado (substitua pelo Kiro quando disponível)"
fi

# ─── 5. Instalar Python e dependências ───────────
echo ""
echo "[5/7] Instalando Python e dependências da bridge..."
apt install -y -qq python3-full python3-venv python3-pip git 2>/dev/null

# Setup do projeto
BRIDGE_DIR="/opt/kiro-bridge"
if [ -d "$BRIDGE_DIR" ]; then
    cd "$BRIDGE_DIR" && git pull
else
    git clone https://github.com/VagnerMafort/interface-kiro.git "$BRIDGE_DIR"
fi

cd "$BRIDGE_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
pip install websockify -q

# Baixar noVNC localmente
NOVNC_DIR="$BRIDGE_DIR/static/vendor/noVNC"
if [ ! -d "$NOVNC_DIR" ]; then
    echo "  -> Baixando noVNC..."
    git clone --depth 1 https://github.com/novnc/noVNC.git "$NOVNC_DIR"
    echo "  -> noVNC instalado"
else
    echo "  -> noVNC já existe"
fi

# Criar .env
cat > .env << ENVFILE
VNC_HOST=localhost
VNC_PORT=$VNC_PORT
VNC_PASSWORD=$VNC_PASSWORD
WEBSOCKIFY_PORT=6081
APP_PORT=$APP_PORT
SECRET_KEY=$(openssl rand -hex 32)
ENVFILE

echo "  -> Bridge configurada em $BRIDGE_DIR"

# ─── 6. Criar serviços systemd ───────────────────
echo ""
echo "[6/7] Criando serviços systemd..."

# Serviço VNC
cat > /etc/systemd/system/kiro-vnc.service << 'VNCSERVICE'
[Unit]
Description=Kiro VNC Desktop Virtual
After=network.target

[Service]
Type=simple
User=root
Environment=DISPLAY=:1
ExecStartPre=/usr/bin/bash -c '/usr/bin/vncserver -kill :1 2>/dev/null; rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null; true'
ExecStart=/usr/bin/vncserver :1 -geometry 1920x1080 -depth 24 -localhost no -fg
ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
VNCSERVICE

# Serviço Bridge
cat > /etc/systemd/system/kiro-bridge.service << BRIDGESERVICE
[Unit]
Description=Kiro Mobile Bridge
After=network.target kiro-vnc.service
Wants=kiro-vnc.service

[Service]
Type=simple
User=root
WorkingDirectory=$BRIDGE_DIR
Environment=PATH=$BRIDGE_DIR/venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$BRIDGE_DIR/venv/bin/python app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
BRIDGESERVICE

systemctl daemon-reload
systemctl enable kiro-vnc.service
systemctl enable kiro-bridge.service

echo "  -> Serviços criados e habilitados"

# ─── 7. Iniciar tudo ─────────────────────────────
echo ""
echo "[7/7] Iniciando serviços..."

systemctl start kiro-vnc.service
sleep 3
systemctl start kiro-bridge.service
sleep 2

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║          SETUP COMPLETO!                     ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║  Desktop virtual: rodando no display :1      ║"
echo "║  VNC Server: porta $VNC_PORT                      ║"
echo "║  Bridge: porta $APP_PORT                      ║"
echo "║                                              ║"
echo "║  Acesse pelo celular:                        ║"
echo "║  http://SEU_IP_VPS:$APP_PORT                  ║"
echo "║                                              ║"
echo "║  Senha VNC: $VNC_PASSWORD                        ║"
echo "║                                              ║"
echo "║  Para instalar o Kiro:                       ║"
echo "║  1. Baixe o .deb em https://kiro.dev         ║"
echo "║  2. dpkg -i kiro_*.deb && apt -f install -y  ║"
echo "║  3. Abra pelo desktop virtual                ║"
echo "║                                              ║"
echo "║  Comandos úteis:                             ║"
echo "║  systemctl status kiro-vnc                   ║"
echo "║  systemctl status kiro-bridge                ║"
echo "║  systemctl restart kiro-vnc                  ║"
echo "║  systemctl restart kiro-bridge               ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
