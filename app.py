"""
Kiro Mobile Bridge - Interface responsiva para acessar o Kiro pelo celular.
Atua como proxy entre o celular (interface web responsiva) e o desktop (VNC/noVNC).
"""

import os
import subprocess
import signal
import sys
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "kiro-mobile-bridge-secret")

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Configurações
VNC_HOST = os.getenv("VNC_HOST", "localhost")
VNC_PORT = int(os.getenv("VNC_PORT", "5900"))
NOVNC_PORT = int(os.getenv("NOVNC_PORT", "6080"))
WEBSOCKIFY_PORT = int(os.getenv("WEBSOCKIFY_PORT", "6081"))
APP_PORT = int(os.getenv("APP_PORT", "8080"))
VNC_PASSWORD = os.getenv("VNC_PASSWORD", "kiro123")

novnc_process = None
websockify_process = None


def start_websockify():
    """Inicia o websockify para fazer a ponte WebSocket <-> VNC."""
    global websockify_process
    try:
        websockify_process = subprocess.Popen(
            [
                "websockify",
                "--web", find_novnc_path(),
                str(WEBSOCKIFY_PORT),
                f"{VNC_HOST}:{VNC_PORT}",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        print(f"[OK] Websockify rodando na porta {WEBSOCKIFY_PORT}")
    except FileNotFoundError:
        print("[AVISO] websockify não encontrado. Instale com: pip install websockify")
    except Exception as e:
        print(f"[ERRO] Falha ao iniciar websockify: {e}")


def find_novnc_path():
    """Tenta encontrar o diretório do noVNC."""
    paths = [
        "/usr/share/novnc",
        "/usr/share/noVNC",
        "/opt/novnc",
        os.path.join(os.path.dirname(__file__), "novnc"),
        os.path.join(os.path.dirname(__file__), "noVNC"),
    ]
    for p in paths:
        if os.path.isdir(p):
            return p
    return os.path.join(os.path.dirname(__file__), "novnc")


def cleanup(signum=None, frame=None):
    """Limpa processos ao encerrar."""
    global websockify_process
    if websockify_process:
        websockify_process.terminate()
        print("[OK] Websockify encerrado")
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


# ─── Rotas ───────────────────────────────────────────────

@app.route("/")
def index():
    """Página principal - interface mobile responsiva."""
    return render_template(
        "index.html",
        vnc_host=VNC_HOST,
        vnc_port=VNC_PORT,
        websockify_port=WEBSOCKIFY_PORT,
        vnc_password=VNC_PASSWORD,
    )


@app.route("/health")
def health():
    """Health check."""
    return jsonify({"status": "ok", "vnc_host": VNC_HOST, "vnc_port": VNC_PORT})


@app.route("/api/config")
def get_config():
    """Retorna configuração para o cliente."""
    return jsonify({
        "vnc_host": VNC_HOST,
        "websockify_port": WEBSOCKIFY_PORT,
        "vnc_password": VNC_PASSWORD,
    })


# ─── WebSocket Events ───────────────────────────────────

@socketio.on("connect")
def handle_connect():
    print("[WS] Cliente conectado")
    emit("status", {"connected": True})


@socketio.on("disconnect")
def handle_disconnect():
    print("[WS] Cliente desconectado")


@socketio.on("keyboard_input")
def handle_keyboard(data):
    """Recebe input do teclado virtual mobile."""
    emit("key_event", data, broadcast=True)


@socketio.on("shortcut")
def handle_shortcut(data):
    """Recebe atalhos da toolbar mobile."""
    emit("shortcut_event", data, broadcast=True)


# ─── Main ────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("  Kiro Mobile Bridge")
    print(f"  Interface: http://0.0.0.0:{APP_PORT}")
    print(f"  VNC Target: {VNC_HOST}:{VNC_PORT}")
    print(f"  Websockify: porta {WEBSOCKIFY_PORT}")
    print("=" * 50)

    start_websockify()
    socketio.run(app, host="0.0.0.0", port=APP_PORT, debug=False)
