"""
Kiro Mobile Bridge v4 - Integração direta com kiro-cli chat
Sem VNC, sem OCR. Chat direto com o Kiro.
"""

import os
import subprocess
import signal
import sys
import json
import threading
import time
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "kiro-mobile-bridge-secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

APP_PORT = int(os.getenv("APP_PORT", "9090"))

# Estado das sessões de chat
chat_sessions = {}


class KiroChatSession:
    """Gerencia uma sessão de chat com kiro-cli."""

    def __init__(self, project_path, session_id=None):
        self.project_path = project_path
        self.session_id = session_id
        self.history = []
        self.busy = False

    def send(self, message):
        """Envia mensagem pro kiro-cli e retorna a resposta."""
        self.busy = True
        try:
            cmd = ["kiro-cli", "chat", "--no-interactive", "-a"]

            if self.session_id:
                cmd.extend(["--resume-id", self.session_id])

            cmd.append(message)

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=self.project_path,
            )

            response = result.stdout.strip()
            if not response and result.stderr:
                response = f"[Erro] {result.stderr.strip()}"

            self.history.append({"role": "user", "text": message})
            self.history.append({"role": "assistant", "text": response})

            return response

        except subprocess.TimeoutExpired:
            return "[Tempo esgotado - o Kiro demorou mais de 2 minutos para responder]"
        except Exception as e:
            return f"[Erro] {str(e)}"
        finally:
            self.busy = False

    def get_sessions(self):
        """Lista sessões salvas do projeto."""
        try:
            result = subprocess.run(
                ["kiro-cli", "chat", "--list-sessions", "-f", "json"],
                capture_output=True, text=True, timeout=10,
                cwd=self.project_path,
            )
            return json.loads(result.stdout) if result.stdout.strip() else []
        except Exception:
            return []


def get_session(project):
    """Retorna ou cria sessão de chat para o projeto."""
    if project not in chat_sessions:
        path = f"/root/{project}"
        if not os.path.isdir(path):
            path = "/root"
        chat_sessions[project] = KiroChatSession(path)
    return chat_sessions[project]


# ─── Rotas ───────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/projects")
def api_projects():
    """Lista projetos disponíveis em /root."""
    projects = []
    for name in os.listdir("/root"):
        path = f"/root/{name}"
        if os.path.isdir(path) and os.path.isdir(f"{path}/.git"):
            projects.append({"name": name, "path": path})
    return jsonify(projects)


@app.route("/api/chat", methods=["POST"])
def api_chat():
    """Envia mensagem para o Kiro e retorna resposta."""
    data = request.get_json()
    message = data.get("message", "").strip()
    project = data.get("project", "interface-kiro")

    if not message:
        return jsonify({"error": "Mensagem vazia"}), 400

    session = get_session(project)

    if session.busy:
        return jsonify({"error": "Kiro está processando outra mensagem. Aguarde."}), 429

    response = session.send(message)
    return jsonify({
        "response": response,
        "project": project,
    })


@app.route("/api/chat/history")
def api_chat_history():
    """Retorna histórico do chat atual."""
    project = request.args.get("project", "interface-kiro")
    session = get_session(project)
    return jsonify(session.history)


@app.route("/api/chat/sessions")
def api_chat_sessions():
    """Lista sessões salvas do projeto."""
    project = request.args.get("project", "interface-kiro")
    session = get_session(project)
    return jsonify(session.get_sessions())


@app.route("/api/models")
def api_models():
    """Lista modelos disponíveis."""
    try:
        result = subprocess.run(
            ["kiro-cli", "chat", "--list-models", "-f", "json"],
            capture_output=True, text=True, timeout=10,
        )
        return jsonify(json.loads(result.stdout) if result.stdout.strip() else [])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── WebSocket para chat em tempo real ───────────────────

@socketio.on("chat_message")
def handle_chat_message(data):
    """Recebe mensagem via WebSocket e responde em tempo real."""
    message = data.get("message", "").strip()
    project = data.get("project", "interface-kiro")

    if not message:
        emit("chat_response", {"error": "Mensagem vazia"})
        return

    session = get_session(project)

    if session.busy:
        emit("chat_response", {"error": "Kiro está processando. Aguarde."})
        return

    emit("chat_status", {"status": "thinking", "project": project})

    # Roda em thread separada pra não bloquear
    def process():
        response = session.send(message)
        socketio.emit("chat_response", {
            "response": response,
            "project": project,
        })
        socketio.emit("chat_status", {"status": "idle"})

    thread = threading.Thread(target=process)
    thread.start()


@socketio.on("connect")
def handle_connect():
    emit("status", {"connected": True})


# ─── Main ────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("  Kiro Mobile Bridge v4")
    print(f"  Interface: http://0.0.0.0:{APP_PORT}")
    print("  Backend: kiro-cli chat (direto)")
    print("  API: /api/chat, /api/projects, /api/models")
    print("=" * 50)

    socketio.run(app, host="0.0.0.0", port=APP_PORT, debug=False)
