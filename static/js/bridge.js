/**
 * Kiro Mobile Bridge - Lógica de ponte Desktop ↔ Mobile
 * Usa noVNC (RFB) para conectar ao desktop via WebSocket.
 */

import RFB from "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/lib/rfb.js";

// ─── Estado ──────────────────────────────────────
const state = {
    rfb: null,
    connected: false,
    touchMode: "touchpad",  // "touchpad" ou "direct"
    mouseMode: false,
    quality: "auto",
    scale: 100,
};

// ─── Elementos DOM ───────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
    connectScreen: $("#connect-screen"),
    mainScreen: $("#main-screen"),
    vncScreen: $("#vnc-screen"),
    loadingOverlay: $("#loading-overlay"),
    connectStatus: $("#connect-status"),
    connectionInfo: $("#connection-info"),
    hiddenInput: $("#hidden-keyboard-input"),
    sidePanel: $("#side-panel"),
    panelOverlay: $("#panel-overlay"),
    shortcutBar: $("#shortcut-bar"),
    scaleSlider: $("#scale-slider"),
    scaleValue: $("#scale-value"),
};

// ─── Conexão VNC ─────────────────────────────────

function connect() {
    const host = $("#vnc-host").value.trim();
    const port = $("#vnc-port").value.trim();
    const password = $("#vnc-password").value;

    if (!host || !port) {
        showStatus("Preencha host e porta", "error");
        return;
    }

    showStatus("Conectando...", "info");
    $("#btn-connect").disabled = true;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${host}:${port}`;

    try {
        // Limpa canvas anterior
        els.vncScreen.innerHTML = "";

        state.rfb = new RFB(els.vncScreen, url, {
            credentials: { password: password },
            wsProtocols: ["binary"],
        });

        // Configurações do RFB
        state.rfb.viewOnly = false;
        state.rfb.scaleViewport = true;
        state.rfb.clipViewport = true;
        state.rfb.resizeSession = false;
        state.rfb.showDotCursor = true;
        state.rfb.qualityLevel = 6;
        state.rfb.compressionLevel = 2;

        // Eventos
        state.rfb.addEventListener("connect", onConnect);
        state.rfb.addEventListener("disconnect", onDisconnect);
        state.rfb.addEventListener("credentialsrequired", onCredentials);
        state.rfb.addEventListener("desktopname", onDesktopName);

    } catch (err) {
        showStatus(`Erro: ${err.message}`, "error");
        $("#btn-connect").disabled = false;
    }
}

function disconnect() {
    if (state.rfb) {
        state.rfb.disconnect();
        state.rfb = null;
    }
    state.connected = false;
    switchScreen("connect");
}

function onConnect() {
    state.connected = true;
    showStatus("Conectado!", "success");
    switchScreen("main");
    els.loadingOverlay.classList.add("hidden");
    applyQuality(state.quality);
}

function onDisconnect(e) {
    state.connected = false;
    const clean = e.detail.clean;
    if (!clean) {
        showStatus("Conexão perdida. Verifique o servidor VNC.", "error");
    }
    switchScreen("connect");
    $("#btn-connect").disabled = false;
}

function onCredentials() {
    const password = $("#vnc-password").value;
    if (state.rfb && password) {
        state.rfb.sendCredentials({ password });
    }
}

function onDesktopName(e) {
    els.connectionInfo.textContent = e.detail.name || "Kiro Mobile Bridge";
}

// ─── Telas ───────────────────────────────────────

function switchScreen(name) {
    els.connectScreen.classList.toggle("active", name === "connect");
    els.mainScreen.classList.toggle("active", name === "main");
}

function showStatus(msg, type = "") {
    els.connectStatus.textContent = msg;
    els.connectStatus.className = `status-msg ${type}`;
}

// ─── Atalhos de Teclado ──────────────────────────

const KEY_MAP = {
    "ctrl": "ControlLeft",
    "shift": "ShiftLeft",
    "alt": "AltLeft",
    "meta": "MetaLeft",
    "enter": "Enter",
    "escape": "Escape",
    "tab": "Tab",
    "backspace": "Backspace",
    "delete": "Delete",
    "grave": "Backquote",
    "space": "Space",
};

function sendKeyCombo(keysStr) {
    if (!state.rfb || !state.connected) return;

    const keys = keysStr.split("+").map(k => k.trim().toLowerCase());
    const xkeys = keys.map(k => {
        if (KEY_MAP[k]) return KEY_MAP[k];
        if (k.length === 1) return `Key${k.toUpperCase()}`;
        return k;
    });

    // Key down em ordem
    xkeys.forEach(k => {
        state.rfb.sendKey(keysymFromName(k), k, true);
    });

    // Key up em ordem reversa
    [...xkeys].reverse().forEach(k => {
        state.rfb.sendKey(keysymFromName(k), k, false);
    });
}

function keysymFromName(name) {
    const map = {
        "ControlLeft": 0xFFE3, "ControlRight": 0xFFE4,
        "ShiftLeft": 0xFFE1, "ShiftRight": 0xFFE2,
        "AltLeft": 0xFFE9, "AltRight": 0xFFEA,
        "MetaLeft": 0xFFE7, "MetaRight": 0xFFE8,
        "Enter": 0xFF0D, "Escape": 0xFF1B,
        "Tab": 0xFF09, "Backspace": 0xFF08,
        "Delete": 0xFFFF, "Space": 0x0020,
        "Backquote": 0x0060,
        "ArrowUp": 0xFF52, "ArrowDown": 0xFF54,
        "ArrowLeft": 0xFF51, "ArrowRight": 0xFF53,
    };
    if (map[name]) return map[name];
    // Letras
    if (name.startsWith("Key")) {
        return name.charCodeAt(3);
    }
    return 0;
}

// ─── Teclado Virtual ─────────────────────────────

function setupKeyboardInput() {
    const input = els.hiddenInput;

    $("#btn-keyboard").addEventListener("click", () => {
        input.focus();
        input.click();
    });

    input.addEventListener("input", (e) => {
        if (!state.rfb || !state.connected) return;
        const data = e.data;
        if (data) {
            for (const char of data) {
                const code = char.charCodeAt(0);
                state.rfb.sendKey(code, null, true);
                state.rfb.sendKey(code, null, false);
            }
        }
        input.value = "";
    });

    input.addEventListener("keydown", (e) => {
        if (!state.rfb || !state.connected) return;
        if (["Backspace", "Enter", "Tab", "Escape"].includes(e.key)) {
            e.preventDefault();
            const sym = keysymFromName(e.code || e.key);
            if (sym) {
                state.rfb.sendKey(sym, e.code, true);
                state.rfb.sendKey(sym, e.code, false);
            }
        }
    });
}

// ─── Qualidade ───────────────────────────────────

function applyQuality(level) {
    if (!state.rfb) return;
    state.quality = level;
    switch (level) {
        case "high":
            state.rfb.qualityLevel = 9;
            state.rfb.compressionLevel = 0;
            break;
        case "medium":
            state.rfb.qualityLevel = 5;
            state.rfb.compressionLevel = 4;
            break;
        case "low":
            state.rfb.qualityLevel = 1;
            state.rfb.compressionLevel = 9;
            break;
        default: // auto
            state.rfb.qualityLevel = 6;
            state.rfb.compressionLevel = 2;
    }
}

// ─── Painel Lateral ──────────────────────────────

function togglePanel(show) {
    const visible = show !== undefined ? show : els.sidePanel.classList.contains("hidden");
    els.sidePanel.classList.toggle("hidden", !visible);
    els.panelOverlay.classList.toggle("hidden", !visible);
}

// ─── Fullscreen ──────────────────────────────────

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

// ─── Mouse Mode ──────────────────────────────────

function toggleMouseMode() {
    state.touchMode = state.touchMode === "touchpad" ? "direct" : "touchpad";
    $("#btn-mouse-mode").classList.toggle("direct-mode", state.touchMode === "direct");

    if (state.rfb) {
        // Em modo direto, o toque vai direto na posição
        state.rfb.clipViewport = state.touchMode === "touchpad";
        state.rfb.dragViewport = state.touchMode === "touchpad";
    }

    // Atualiza radio no painel
    const radio = $(`input[name="touch-mode"][value="${state.touchMode}"]`);
    if (radio) radio.checked = true;
}

// ─── Event Listeners ─────────────────────────────

function setupEventListeners() {
    // Conectar
    $("#btn-connect").addEventListener("click", connect);
    $("#vnc-password").addEventListener("keydown", (e) => {
        if (e.key === "Enter") connect();
    });

    // Desconectar
    $("#btn-disconnect").addEventListener("click", disconnect);

    // Menu / Painel
    $("#btn-menu").addEventListener("click", () => togglePanel());
    $("#btn-close-panel").addEventListener("click", () => togglePanel(false));
    els.panelOverlay.addEventListener("click", () => togglePanel(false));

    // Fullscreen
    $("#btn-fullscreen").addEventListener("click", toggleFullscreen);

    // Atalhos
    $("#btn-toggle-shortcuts").addEventListener("click", () => {
        els.shortcutBar.classList.toggle("collapsed");
    });

    $$(".shortcut-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const keys = btn.dataset.keys;
            if (keys) sendKeyCombo(keys);
        });
    });

    // Mouse mode
    $("#btn-mouse-mode").addEventListener("click", toggleMouseMode);

    // Qualidade
    $$(".quality-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            $$(".quality-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            applyQuality(btn.dataset.quality);
        });
    });

    // Escala
    els.scaleSlider.addEventListener("input", (e) => {
        state.scale = parseInt(e.target.value);
        els.scaleValue.textContent = `${state.scale}%`;
        if (state.rfb) {
            const canvas = els.vncScreen.querySelector("canvas");
            if (canvas) {
                canvas.style.transform = `scale(${state.scale / 100})`;
                canvas.style.transformOrigin = "top left";
            }
        }
    });

    // Viewport options
    $("#clip-viewport").addEventListener("change", (e) => {
        if (state.rfb) state.rfb.clipViewport = e.target.checked;
    });
    $("#drag-viewport").addEventListener("change", (e) => {
        if (state.rfb) state.rfb.dragViewport = e.target.checked;
    });

    // Touch mode radio
    $$("input[name='touch-mode']").forEach(radio => {
        radio.addEventListener("change", (e) => {
            state.touchMode = e.target.value;
            $("#btn-mouse-mode").classList.toggle("direct-mode", state.touchMode === "direct");
        });
    });

    // Teclado virtual
    setupKeyboardInput();

    // Prevenir zoom do browser no mobile
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => {
        if (state.connected) e.preventDefault();
    });
}

// ─── Init ────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    console.log("[Kiro Mobile Bridge] Pronto!");
});
