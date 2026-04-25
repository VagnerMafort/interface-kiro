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

import re

load_dotenv()

def strip_ansi(text):
    """Remove códigos de cor ANSI do texto."""
    return re.sub(r'\x1b\[[0-9;]*m|\[[\d;]*m|\[\?25[lh]', '', text)


def clean_response(text):
    """Limpa a resposta do kiro-cli, removendo logs de ferramentas e mantendo só a resposta."""
    text = strip_ansi(text)

    # Remove linhas de progresso/ferramentas
    skip_patterns = [
        r'^\s*(Reading|Writing|Searching|Getting|Batch|Creating|Updating|I will run|I\'ll modify|I\'ll create)',
        r'^\s*(↱|⋮|✓|❗|─|\[K|\[2K|\[1G|\[1A)',
        r'^\s*-\s*(Completed|Summary)',
        r'^\s*Purpose:',
        r'^\s*\(using tool:',
        r'^\s*\d+,\s*\d+:',  # diff line numbers
        r'^\s*[+-]\s*\d+:',  # diff additions/removals
        r'^\s*Operation \d+:',
        r'^\s*\d+ more items found',
        r'^\s*Successfully ',
        r'^\s*No matches found',
    ]

    lines = text.split('\n')
    clean_lines = []
    in_tool_block = False

    for line in lines:
        stripped = line.strip()

        # Detecta início de bloco de ferramenta
        if any(re.match(p, stripped) for p in skip_patterns):
            in_tool_block = True
            continue

        # Detecta fim de bloco (linha com > no início = resposta do assistente)
        if stripped.startswith('>') or stripped.startswith('##'):
            in_tool_block = False
            # Remove o > do início
            cleaned = re.sub(r'^>\s*', '', stripped)
            if cleaned:
                clean_lines.append(cleaned)
            continue

        # Pula linhas de bloco de ferramenta
        if in_tool_block:
            # Mas se parece texto normal longo, inclui
            if len(stripped) > 50 and not any(c in stripped for c in ['✓', '↱', '⋮', '[K', '+++']):
                clean_lines.append(stripped)
            continue

        # Linha normal
        if stripped:
            clean_lines.append(stripped)

    result = '\n'.join(clean_lines).strip()

    # Se ficou vazio, retorna o texto original limpo
    if not result:
        return strip_ansi(text).strip()

    return result

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "kiro-mobile-bridge-secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

APP_PORT = int(os.getenv("APP_PORT", "9090"))
KIRO_CLI = os.getenv("KIRO_CLI", "/root/.local/bin/kiro-cli")
HISTORY_DIR = os.path.join(os.path.dirname(__file__), "chat_history")
os.makedirs(HISTORY_DIR, exist_ok=True)

# Estado das sessões de chat
chat_sessions = {}


class KiroChatSession:
    """Gerencia uma sessão de chat com kiro-cli usando --resume."""

    def __init__(self, project_path):
        self.project_path = project_path
        self.project_name = os.path.basename(project_path)
        self.history = self._load_history()
        self.busy = False
        self.first_message = len(self.history) == 0

    def _history_file(self):
        return os.path.join(HISTORY_DIR, f"{self.project_name}.json")

    def _load_history(self):
        path = self._history_file()
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _save_history(self):
        try:
            with open(self._history_file(), "w") as f:
                json.dump(self.history, f, ensure_ascii=False)
        except Exception:
            pass

    def send(self, message):
        """Envia mensagem pro kiro-cli e retorna a resposta limpa."""
        self.busy = True
        try:
            cmd = [KIRO_CLI, "chat", "--no-interactive"]

            # Depois da primeira mensagem, usa --resume pra manter contexto
            if not self.first_message:
                cmd.append("--resume")

            cmd.append(message)

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,
                cwd=self.project_path,
                env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"},
            )

            response = result.stdout.strip()
            response = clean_response(response)
            if not response and result.stderr:
                response = f"[Erro] {strip_ansi(result.stderr.strip())}"

            self.history.append({"role": "user", "text": message})
            self.history.append({"role": "assistant", "text": response})
            self.first_message = False
            self._save_history()

            return response

        except subprocess.TimeoutExpired:
            return "[Tempo esgotado - o Kiro demorou mais de 2 minutos para responder]"
        except Exception as e:
            return f"[Erro] {str(e)}"
        finally:
            self.busy = False

    def reset(self):
        """Reseta a sessão (novo chat)."""
        self.history = []
        self.first_message = True
        self._save_history()


def get_session(project):
    """Retorna ou cria sessão de chat para o projeto."""
    if project not in chat_sessions:
        path = f"/root/{project}"
        if not os.path.isdir(path):
            path = "/root"
        chat_sessions[project] = KiroChatSession(path)
    return chat_sessions[project]


def reset_session(project):
    """Reseta sessão do projeto (novo chat)."""
    if project in chat_sessions:
        chat_sessions[project].reset()
    else:
        get_session(project)


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


@app.route("/api/chat/reset", methods=["POST"])
def api_chat_reset():
    """Reseta o chat do projeto (nova conversa)."""
    data = request.get_json() or {}
    project = data.get("project", "interface-kiro")
    reset_session(project)
    return jsonify({"ok": True, "project": project})


@app.route("/api/git/status", methods=["POST"])
def api_git_status():
    """Git status do projeto."""
    data = request.get_json() or {}
    project = data.get("project", "interface-kiro")
    path = f"/root/{project}"
    if not os.path.isdir(path):
        return jsonify({"error": "Projeto não encontrado"}), 404
    try:
        result = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, timeout=10, cwd=path,
        )
        return jsonify({"output": result.stdout.strip(), "project": project})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/git/push", methods=["POST"])
def api_git_push():
    """Git add + commit + push do projeto."""
    data = request.get_json() or {}
    project = data.get("project", "interface-kiro")
    message = data.get("message", "update via Kiro Mobile")
    path = f"/root/{project}"
    if not os.path.isdir(path):
        return jsonify({"error": "Projeto não encontrado"}), 404
    try:
        env = os.environ.copy()
        # Git add
        subprocess.run(["git", "add", "-A"], cwd=path, timeout=10,
                       capture_output=True, text=True)
        # Git commit
        commit = subprocess.run(
            ["git", "commit", "-m", message],
            cwd=path, timeout=10, capture_output=True, text=True,
        )
        if "nothing to commit" in (commit.stdout + commit.stderr):
            return jsonify({"output": "Nada para commitar. Tudo já está atualizado.", "project": project})
        # Git push
        push = subprocess.run(
            ["git", "push"],
            cwd=path, timeout=30, capture_output=True, text=True,
        )
        output = commit.stdout.strip() + "\n" + push.stdout.strip() + push.stderr.strip()
        return jsonify({"output": strip_ansi(output.strip()), "project": project})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/git/pull", methods=["POST"])
def api_git_pull():
    """Git pull do projeto."""
    data = request.get_json() or {}
    project = data.get("project", "interface-kiro")
    path = f"/root/{project}"
    if not os.path.isdir(path):
        return jsonify({"error": "Projeto não encontrado"}), 404
    try:
        result = subprocess.run(
            ["git", "pull"],
            cwd=path, timeout=30, capture_output=True, text=True,
        )
        output = result.stdout.strip() + "\n" + result.stderr.strip()
        return jsonify({"output": strip_ansi(output.strip()), "project": project})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/models")
def api_models():
    """Lista modelos disponíveis."""
    try:
        result = subprocess.run(
            [KIRO_CLI, "chat", "--list-models", "-f", "json"],
            capture_output=True, text=True, timeout=10,
        )
        return jsonify(json.loads(result.stdout) if result.stdout.strip() else [])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/project/create", methods=["POST"])
def api_create_project():
    """Cria novo projeto: init git, cria no GitHub e clona."""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Nome do projeto vazio"}), 400

    # Sanitiza nome
    name = re.sub(r'[^a-zA-Z0-9_-]', '-', name).lower()
    path = f"/root/{name}"

    if os.path.exists(path):
        return jsonify({"error": f"Projeto '{name}' já existe"}), 400

    try:
        # Cria diretório
        os.makedirs(path)

        # Init git
        subprocess.run(["git", "init"], cwd=path, capture_output=True, timeout=10)

        # Cria README
        with open(f"{path}/README.md", "w") as f:
            f.write(f"# {name}\n\nProjeto criado via Kiro Mobile.\n")

        # Commit inicial
        subprocess.run(["git", "add", "-A"], cwd=path, capture_output=True, timeout=10)
        subprocess.run(["git", "commit", "-m", "initial commit"], cwd=path, capture_output=True, timeout=10)
        subprocess.run(["git", "branch", "-M", "main"], cwd=path, capture_output=True, timeout=10)

        # Configura remote com username do git credentials
        try:
            with open(os.path.expanduser("~/.git-credentials"), "r") as f:
                import urllib.parse
                parsed = urllib.parse.urlparse(f.read().strip())
                username = parsed.username or "VagnerMafort"
        except Exception:
            username = "VagnerMafort"

        remote_url = f"https://github.com/{username}/{name}.git"
        subprocess.run(["git", "remote", "add", "origin", remote_url], cwd=path, capture_output=True, timeout=10)

        return jsonify({
            "ok": True,
            "name": name,
            "path": path,
            "note": f"Projeto criado! Crie o repo '{name}' no GitHub e faça Push.",
            "remote": remote_url,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/project/delete", methods=["POST"])
def api_delete_project():
    """Deleta um projeto local."""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Nome vazio"}), 400

    path = f"/root/{name}"
    if not os.path.isdir(path):
        return jsonify({"error": "Projeto não encontrado"}), 404

    # Proteção: não deletar projetos importantes
    protected = ["interface-kiro", "veo3-tool"]
    if name in protected:
        return jsonify({"error": f"Projeto '{name}' é protegido e não pode ser deletado"}), 403

    try:
        import shutil
        shutil.rmtree(path)
        # Remove sessão e histórico
        if name in chat_sessions:
            del chat_sessions[name]
        hist_file = os.path.join(HISTORY_DIR, f"{name}.json")
        if os.path.exists(hist_file):
            os.remove(hist_file)
        return jsonify({"ok": True, "name": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/project/create-github", methods=["POST"])
def api_create_github_repo():
    """Cria repo no GitHub via API e faz push."""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Nome vazio"}), 400

    path = f"/root/{name}"
    if not os.path.isdir(path):
        return jsonify({"error": "Projeto local não encontrado"}), 404

    try:
        # Pega token do git credentials
        token = None
        username = "VagnerMafort"
        try:
            with open(os.path.expanduser("~/.git-credentials"), "r") as f:
                import urllib.parse
                parsed = urllib.parse.urlparse(f.read().strip())
                token = parsed.password
                username = parsed.username or username
        except Exception:
            pass

        if not token:
            return jsonify({"error": "Token GitHub não encontrado. Configure git credentials."}), 400

        # Cria repo via GitHub API
        import urllib.request
        req = urllib.request.Request(
            "https://api.github.com/user/repos",
            data=json.dumps({"name": name, "private": False, "auto_init": False}).encode(),
            headers={
                "Authorization": f"token {token}",
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            resp = urllib.request.urlopen(req, timeout=15)
            repo_data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if "already exists" in body:
                pass  # Repo já existe, continua com push
            else:
                return jsonify({"error": f"GitHub API: {body}"}), 400

        # Configura remote e push
        remote_url = f"https://github.com/{username}/{name}.git"
        subprocess.run(["git", "remote", "remove", "origin"], cwd=path, capture_output=True, timeout=5)
        subprocess.run(["git", "remote", "add", "origin", remote_url], cwd=path, capture_output=True, timeout=5)
        push = subprocess.run(["git", "push", "-u", "origin", "main"], cwd=path, capture_output=True, text=True, timeout=30)

        output = push.stdout.strip() + "\n" + push.stderr.strip()
        return jsonify({"ok": True, "output": strip_ansi(output.strip()), "remote": remote_url})

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
