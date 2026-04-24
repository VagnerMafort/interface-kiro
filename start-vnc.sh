#!/bin/bash
# ═══════════════════════════════════════════════════
# Inicia o servidor VNC para o Kiro Mobile Bridge
# ═══════════════════════════════════════════════════

source .env 2>/dev/null

VNC_PASSWORD="${VNC_PASSWORD:-kiro123}"
VNC_PORT="${VNC_PORT:-5900}"

OS="$(uname -s)"

echo "[*] Iniciando servidor VNC na porta $VNC_PORT..."

case "$OS" in
    Linux*)
        # Mata instância anterior se existir
        killall x11vnc 2>/dev/null || true
        sleep 1

        x11vnc \
            -display :0 \
            -rfbport "$VNC_PORT" \
            -passwd "$VNC_PASSWORD" \
            -forever \
            -shared \
            -noxdamage \
            -ncache 10 \
            -threads \
            &

        echo "[OK] x11vnc rodando (PID: $!)"
        ;;
    Darwin*)
        echo "[INFO] No macOS, ative o Compartilhamento de Tela:"
        echo "  Preferências do Sistema > Compartilhamento > Compartilhamento de Tela"
        echo "  Ou use: open vnc://localhost"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "[INFO] No Windows, inicie o TightVNC/TigerVNC Server manualmente."
        echo "  Certifique-se de que está rodando na porta $VNC_PORT"
        ;;
esac

echo ""
echo "[*] Agora inicie a bridge: python app.py"
