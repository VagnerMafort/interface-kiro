#!/bin/bash
# ═══════════════════════════════════════════════════
# Kiro Mobile Bridge - Script de Instalação
# ═══════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════╗"
echo "║     Kiro Mobile Bridge - Instalação      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Detecta OS
OS="$(uname -s)"
echo "[*] Sistema detectado: $OS"

# 1. Python e pip
echo ""
echo "[1/5] Verificando Python..."
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "[ERRO] Python não encontrado. Instale Python 3.8+"
    exit 1
fi
echo "  -> $($PYTHON --version)"

# 2. Ambiente virtual
echo ""
echo "[2/5] Criando ambiente virtual..."
if [ ! -d "venv" ]; then
    $PYTHON -m venv venv
    echo "  -> venv criado"
else
    echo "  -> venv já existe"
fi

# Ativa venv
if [ "$OS" = "MINGW64_NT"* ] || [ "$OS" = "MSYS_NT"* ]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi

# 3. Dependências Python
echo ""
echo "[3/5] Instalando dependências Python..."
pip install --upgrade pip -q
pip install -r requirements.txt -q
pip install websockify -q
echo "  -> Dependências instaladas"

# 4. Servidor VNC
echo ""
echo "[4/5] Verificando servidor VNC..."
case "$OS" in
    Linux*)
        if ! command -v x11vnc &>/dev/null; then
            echo "  -> Instalando x11vnc..."
            if command -v apt-get &>/dev/null; then
                sudo apt-get update -qq && sudo apt-get install -y -qq x11vnc
            elif command -v dnf &>/dev/null; then
                sudo dnf install -y x11vnc
            elif command -v pacman &>/dev/null; then
                sudo pacman -S --noconfirm x11vnc
            fi
        fi
        echo "  -> x11vnc disponível"
        ;;
    Darwin*)
        echo "  -> macOS: Use 'Compartilhamento de Tela' nas Preferências do Sistema"
        echo "     Ou instale: brew install tiger-vnc"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "  -> Windows: Recomendamos TightVNC ou TigerVNC Server"
        echo "     Download: https://www.tightvnc.com/download.php"
        ;;
esac

# 5. Configuração
echo ""
echo "[5/5] Configuração..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "  -> .env criado a partir do .env.example"
    echo "  -> EDITE o arquivo .env com suas configurações!"
else
    echo "  -> .env já existe"
fi

# Cria diretório de ícones PWA
mkdir -p static/icons

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         Instalação Concluída!            ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║  Próximos passos:                        ║"
echo "║                                          ║"
echo "║  1. Inicie um servidor VNC:              ║"
echo "║     Linux: x11vnc -display :0 -passwd    ║"
echo "║            kiro123 -forever               ║"
echo "║     Windows: Inicie TightVNC Server      ║"
echo "║                                          ║"
echo "║  2. Edite o .env se necessário           ║"
echo "║                                          ║"
echo "║  3. Inicie a bridge:                     ║"
echo "║     python app.py                        ║"
echo "║                                          ║"
echo "║  4. Acesse pelo celular:                 ║"
echo "║     http://SEU_IP:8080                   ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
