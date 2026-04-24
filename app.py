"""
Kiro Mobile Bridge v3 - Interface mobile + API de captura do desktop
"""

import os
import subprocess
import signal
import sys
import time
import json
import hashlib
import threading
from io import BytesIO
from flask import Flask, render_template, jsonify, request, send_file
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "kiro-mobile-bridge-secret")

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Configurações
VNC_HOST = os.getenv("VNC_HOST", "localhost")
VNC_PORT = int(os.getenv("VNC_PORT", "5901"))
NOVNC_PORT = int(os.getenv("NOVNC_PORT", "6080"))
WEBSOCKIFY_PORT = int(os.getenv("WEBSOCKIFY_PORT", "6081"))
APP_PORT = int(os.getenv("APP_PORT", "9090"))
VNC_PASSWORD = os.getenv("VNC_PASSWORD", "kiro123")
DISPLAY = os.getenv("DISPLAY", ":1")

websockify_process = None

# Cache para OCR (evita reprocessar a mesma imagem)
ocr_cache = {"hash": "", "text": "", "timestamp": 0}


def start_websockify():
    global websockify_process
    try:
        websockify_process = subprocess.Popen(
            ["websockify", "--web", find_novnc_path(),
             str(WEBSOCKIFY_PORT), f"{VNC_HOST}:{VNC_PORT}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        print(f"[OK] Websockify porta {WEBSOCKIFY_PORT}")
    except Exception as e:
        print(f"[AVISO] websockify: {e}")


def find_novnc_path():
    for p in ["/usr/share/novnc", "/usr/share/noVNC", "/opt/novnc"]:
        if os.path.isdir(p):
            return p
    return os.path.join(os.path.dirname(__file__), "novnc")


def cleanup(signum=None, frame=None):
    if websockify_process:
        websockify_process.terminate()
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


def take_screenshot(region=None):
    """Tira screenshot do desktop virtual usando xdotool + import (ImageMagick)."""
    try:
        env = os.environ.copy()
        env["DISPLAY"] = DISPLAY
        filepath = "/tmp/kiro_screen.png"

        if region:
            # region = "WxH+X+Y" ex: "500x800+1400+50"
            cmd = ["import", "-window", "root", "-crop", region, filepath]
        else:
            cmd = ["import", "-window", "root", filepath]

        subprocess.run(cmd, env=env, timeout=5, capture_output=True)
        return filepath
    except Exception as e:
        print(f"[ERRO] Screenshot: {e}")
        return None


def ocr_image(filepath):
    """Extrai texto da imagem usando tesseract OCR."""
    try:
        result = subprocess.run(
            ["tesseract", filepath, "stdout", "-l", "eng+por", "--psm", "6"],
            capture_output=True, text=True, timeout=10
        )
        return result.stdout.strip()
    except FileNotFoundError:
        # Tesseract não instalado, tenta com python
        try:
            from PIL import Image
            import pytesseract
            img = Image.open(filepath)
            return pytesseract.image_to_string(img, lang="eng+por")
        except Exception:
            return "[OCR não disponível - instale tesseract: apt install tesseract-ocr]"
    except Exception as e:
        return f"[Erro OCR: {e}]"


# ─── Rotas ───────────────────────────────────────────────

@app.route("/")
def index():
    return render_template(
        "index.html",
        vnc_host=VNC_HOST, vnc_port=VNC_PORT,
        websockify_port=WEBSOCKIFY_PORT, vnc_password=VNC_PASSWORD,
    )


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/screenshot")
def api_screenshot():
    """Retorna screenshot do desktop como imagem PNG."""
    region = request.args.get("region", None)
    filepath = take_screenshot(region)
    if filepath and os.path.exists(filepath):
        return send_file(filepath, mimetype="image/png")
    return jsonify({"error": "Falha ao capturar tela"}), 500


@app.route("/api/screenshot/chat")
def api_screenshot_chat():
    """Screenshot da área do chat do Kiro (lado direito da tela)."""
    # Kiro chat fica ~75% da largura, toda a altura
    filepath = take_screenshot("500x1000+1420+50")
    if filepath and os.path.exists(filepath):
        return send_file(filepath, mimetype="image/png")
    return jsonify({"error": "Falha ao capturar chat"}), 500


@app.route("/api/ocr")
def api_ocr():
    """Captura a tela e extrai texto via OCR."""
    region = request.args.get("region", None)
    filepath = take_screenshot(region)
    if not filepath:
        return jsonify({"error": "Falha ao capturar tela"}), 500

    # Verifica cache
    with open(filepath, "rb") as f:
        img_hash = hashlib.md5(f.read()).hexdigest()

    if img_hash == ocr_cache["hash"] and time.time() - ocr_cache["timestamp"] < 5:
        return jsonify({"text": ocr_cache["text"], "cached": True})

    text = ocr_image(filepath)
    ocr_cache["hash"] = img_hash
    ocr_cache["text"] = text
    ocr_cache["timestamp"] = time.time()

    return jsonify({"text": text, "cached": False})


@app.route("/api/ocr/chat")
def api_ocr_chat():
    """Extrai texto da área do chat do Kiro."""
    filepath = take_screenshot("500x1000+1420+50")
    if not filepath:
        return jsonify({"error": "Falha"}), 500
    text = ocr_image(filepath)
    return jsonify({"text": text})


@app.route("/api/type", methods=["POST"])
def api_type():
    """Digita texto no desktop virtual usando xdotool."""
    data = request.get_json()
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "Texto vazio"}), 400

    try:
        env = os.environ.copy()
        env["DISPLAY"] = DISPLAY
        # Digita o texto
        subprocess.run(
            ["xdotool", "type", "--clearmodifiers", "--delay", "20", text],
            env=env, timeout=10
        )
        return jsonify({"ok": True, "typed": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/key", methods=["POST"])
def api_key():
    """Envia combinação de teclas via xdotool."""
    data = request.get_json()
    keys = data.get("keys", "")
    if not keys:
        return jsonify({"error": "Teclas vazias"}), 400

    try:
        env = os.environ.copy()
        env["DISPLAY"] = DISPLAY
        subprocess.run(
            ["xdotool", "key", "--clearmodifiers", keys],
            env=env, timeout=5
        )
        return jsonify({"ok": True, "keys": keys})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/click", methods=["POST"])
def api_click():
    """Clica numa posição do desktop."""
    data = request.get_json()
    x = data.get("x", 0)
    y = data.get("y", 0)

    try:
        env = os.environ.copy()
        env["DISPLAY"] = DISPLAY
        subprocess.run(
            ["xdotool", "mousemove", str(x), str(y), "click", "1"],
            env=env, timeout=5
        )
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── WebSocket ───────────────────────────────────────────

@socketio.on("connect")
def handle_connect():
    emit("status", {"connected": True})


@socketio.on("disconnect")
def handle_disconnect():
    pass


# ─── Main ────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("  Kiro Mobile Bridge v3")
    print(f"  Interface: http://0.0.0.0:{APP_PORT}")
    print(f"  VNC: {VNC_HOST}:{VNC_PORT}")
    print(f"  API: /api/screenshot, /api/ocr, /api/type, /api/key")
    print("=" * 50)

    start_websockify()
    socketio.run(app, host="0.0.0.0", port=APP_PORT, debug=False)
