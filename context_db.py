"""
Context DB - Banco de dados de contexto persistente por projeto.
Armazena conversas, gera resumos e injeta memória de longo prazo nos chats.
"""

import sqlite3
import json
import os
import time
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.expanduser("~"), ".kiro", "kiro_context.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project TEXT NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at TEXT,
            summary TEXT,
            message_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            project TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project TEXT NOT NULL,
            fact TEXT NOT NULL,
            source_session INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (source_session) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
        CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project);
    """)
    conn.close()


# ─── Sessions ────────────────────────────────────────────

def start_session(project):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO sessions (project) VALUES (?)", (project,)
    )
    session_id = cur.lastrowid
    conn.commit()
    conn.close()
    return session_id


def end_session(session_id, summary=None):
    conn = get_db()
    count = conn.execute(
        "SELECT COUNT(*) FROM messages WHERE session_id=?", (session_id,)
    ).fetchone()[0]
    conn.execute(
        "UPDATE sessions SET ended_at=datetime('now'), summary=?, message_count=? WHERE id=?",
        (summary, count, session_id),
    )
    conn.commit()
    conn.close()


# ─── Messages ────────────────────────────────────────────

def add_message(session_id, project, role, content):
    conn = get_db()
    conn.execute(
        "INSERT INTO messages (session_id, project, role, content) VALUES (?,?,?,?)",
        (session_id, project, role, content),
    )
    conn.execute(
        "UPDATE sessions SET message_count = message_count + 1 WHERE id=?",
        (session_id,),
    )
    conn.commit()
    conn.close()


def get_recent_messages(project, limit=20):
    conn = get_db()
    rows = conn.execute(
        "SELECT role, content, created_at FROM messages WHERE project=? ORDER BY id DESC LIMIT ?",
        (project, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]


# ─── Facts (memória de longo prazo) ──────────────────────

def add_fact(project, fact, session_id=None):
    conn = get_db()
    # Evita duplicatas exatas
    existing = conn.execute(
        "SELECT id FROM facts WHERE project=? AND fact=?", (project, fact)
    ).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO facts (project, fact, source_session) VALUES (?,?,?)",
            (project, fact, session_id),
        )
        conn.commit()
    conn.close()


def get_facts(project):
    conn = get_db()
    rows = conn.execute(
        "SELECT fact FROM facts WHERE project=? ORDER BY id DESC", (project,)
    ).fetchall()
    conn.close()
    return [r["fact"] for r in rows]


def delete_fact(project, fact_id):
    conn = get_db()
    conn.execute("DELETE FROM facts WHERE id=? AND project=?", (fact_id, project))
    conn.commit()
    conn.close()


# ─── Context Builder ─────────────────────────────────────

def build_context(project, max_tokens_approx=1500):
    """Monta bloco de contexto para injetar no prompt do kiro-cli.
    Combina: facts + resumos de sessões anteriores + mensagens recentes.
    """
    parts = []

    # 1. Facts do projeto
    facts = get_facts(project)
    if facts:
        parts.append("## Memória do projeto")
        for f in facts[:15]:
            parts.append(f"- {f}")

    # 2. Resumos das últimas sessões
    conn = get_db()
    sessions = conn.execute(
        "SELECT summary, started_at, message_count FROM sessions "
        "WHERE project=? AND summary IS NOT NULL ORDER BY id DESC LIMIT 5",
        (project,),
    ).fetchall()
    conn.close()

    if sessions:
        parts.append("\n## Sessões anteriores")
        for s in reversed(sessions):
            parts.append(f"- [{s['started_at']}] ({s['message_count']} msgs): {s['summary']}")

    # 3. Mensagens recentes (últimas da sessão atual ou anterior)
    recent = get_recent_messages(project, limit=6)
    if recent:
        parts.append("\n## Conversa recente")
        for m in recent:
            role = "User" if m["role"] == "user" else "Kiro"
            text = m["content"][:200].replace("\n", " ")
            parts.append(f"{role}: {text}")

    context = "\n".join(parts)

    # Trunca se muito grande (~4 chars por token)
    max_chars = max_tokens_approx * 4
    if len(context) > max_chars:
        context = context[:max_chars] + "\n[...contexto truncado]"

    return context


# ─── Auto-summary ─────────────────────────────────────────

def generate_session_summary(session_id):
    """Gera resumo simples baseado nas mensagens da sessão."""
    conn = get_db()
    messages = conn.execute(
        "SELECT role, content FROM messages WHERE session_id=? ORDER BY id",
        (session_id,),
    ).fetchall()
    conn.close()

    if not messages:
        return None

    # Pega os tópicos das mensagens do usuário
    user_msgs = [m["content"] for m in messages if m["role"] == "user"]
    if not user_msgs:
        return None

    # Resumo simples: primeiras palavras de cada mensagem do usuário
    topics = []
    for msg in user_msgs[:5]:
        topic = msg[:80].replace("\n", " ").strip()
        if topic:
            topics.append(topic)

    return "; ".join(topics) if topics else None


# ─── Stats ────────────────────────────────────────────────

def get_project_stats(project):
    conn = get_db()
    stats = {}
    stats["total_sessions"] = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE project=?", (project,)
    ).fetchone()[0]
    stats["total_messages"] = conn.execute(
        "SELECT COUNT(*) FROM messages WHERE project=?", (project,)
    ).fetchone()[0]
    stats["total_facts"] = conn.execute(
        "SELECT COUNT(*) FROM facts WHERE project=?", (project,)
    ).fetchone()[0]
    last = conn.execute(
        "SELECT started_at FROM sessions WHERE project=? ORDER BY id DESC LIMIT 1",
        (project,),
    ).fetchone()
    stats["last_session"] = last["started_at"] if last else None
    conn.close()
    return stats


def get_all_projects():
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT project FROM sessions ORDER BY project"
    ).fetchall()
    conn.close()
    return [r["project"] for r in rows]


# Init on import
init_db()
