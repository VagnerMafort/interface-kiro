/**
 * Kiro Mobile Bridge v1.1 - Ponte Desktop ↔ Mobile
 * Interface com 3 modos: Desktop, Foco e Chat
 */

// RFB é carregado globalmente via index.html
const RFB = window.RFB;
import { VoiceModule } from "./voice.js";

// ─── Estado ──────────────────────────────────────
const state = {
    rfb: null,
    connected: false,
    currentView: "desktop",
    touchMode: "touchpad",
    quality: "auto",
    scale: 100,
    focusArea: "editor",
    voice: null,
    lastTranscript: "",
    // Regiões do Kiro (aproximadas, ajustáveis)
    focusRegions: {
        editor:   { x: 0.20, y: 0.06, w: 0.55, h: 0.65 },
        explorer: { x: 0.00, y: 0.06, w: 0.20, h: 0.94 },
        terminal: { x: 0.20, y: 0.71, w: 0.80, h: 0.29 },
        chat:     { x: 0.75, y: 0.06, w: 0.25, h: 0.65 },
    },
};

// ─── DOM Helpers ─────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
    connectScreen: $("#connect-screen"),
    mainScreen: $("#main-screen"),
    vncScreen: $("#vnc-screen"),
    loadingOverlay: $("#loading-overlay"),
    connectStatus: $("#connect-status"),
    hiddenInput: $("#hidden-keyboard-input"),
    sidePanel: $("#side-panel"),
    panelOverlay: $("#panel-overlay"),
    shortcutBar: $("#shortcut-bar"),
    scaleSlider: $("#scale-slider"),
    scaleValue: $("#scale-value"),
    focusCanvas: $("#focus-canvas"),
    focusViewport: $("#focus-viewport"),
    infoHost: $("#info-host"),
    infoPort: $("#info-port"),
    infoStatus: $("#info-status"),
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
        els.vncScreen.innerHTML = "";

        state.rfb = new RFB(els.vncScreen, url, {
            credentials: { password },
            wsProtocols: ["binary"],
        });

        state.rfb.viewOnly = false;
        state.rfb.scaleViewport = true;
        state.rfb.clipViewport = true;
        state.rfb.resizeSession = false;
        state.rfb.showDotCursor = true;
        state.rfb.qualityLevel = 6;
        state.rfb.compressionLevel = 2;

        state.rfb.addEventListener("connect", onConnect);
        state.rfb.addEventListener("disconnect", onDisconnect);
        state.rfb.addEventListener("credentialsrequired", onCredentials);
        state.rfb.addEventListener("desktopname", onDesktopName);

        // Atualiza info no painel
        els.infoHost.textContent = host;
        els.infoPort.textContent = port;

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
    els.infoStatus.textContent = "Desconectado";
    switchScreen("connect");
}

function onConnect() {
    state.connected = true;
    showStatus("Conectado!", "success");
    els.infoStatus.textContent = "Conectado";
    switchScreen("main");
    els.loadingOverlay.classList.add("hidden");
    applyQuality(state.quality);
}

function onDisconnect(e) {
    state.connected = false;
    els.infoStatus.textContent = "Desconectado";
    if (!e.detail.clean) {
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
    const name = e.detail.name || "Kiro Desktop";
    $(".view-tab[data-view='desktop'] span").textContent = name;
}

// ─── Telas e Views ───────────────────────────────

function switchScreen(name) {
    els.connectScreen.classList.toggle("active", name === "connect");
    els.mainScreen.classList.toggle("active", name === "main");
}

function switchView(view) {
    state.currentView = view;
    $$(".view-tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
    $$(".view-panel").forEach(p => p.classList.remove("active"));
    $(`#view-${view}`).classList.add("active");

    // Mostra/esconde botões flutuantes conforme a view
    const showFloating = view === "desktop" || view === "focus";
    $$("#shortcut-bar, #btn-keyboard, #btn-mouse-mode, #btn-fullscreen").forEach(el => {
        el.style.display = showFloating ? "" : "none";
    });

    if (view === "focus") {
        updateFocusView();
    }
}

function showStatus(msg, type = "") {
    els.connectStatus.textContent = msg;
    els.connectStatus.className = `status-msg ${type}`;
}

// ─── Modo Foco ───────────────────────────────────

function updateFocusView() {
    if (!state.rfb || !state.connected) return;

    const canvas = els.vncScreen.querySelector("canvas");
    if (!canvas) return;

    const region = state.focusRegions[state.focusArea];
    if (!region) return;

    const srcX = Math.floor(canvas.width * region.x);
    const srcY = Math.floor(canvas.height * region.y);
    const srcW = Math.floor(canvas.width * region.w);
    const srcH = Math.floor(canvas.height * region.h);

    const focusCanvas = els.focusCanvas;
    const viewport = els.focusViewport;
    const vpW = viewport.clientWidth;
    const vpH = viewport.clientHeight;

    // Escala para preencher o viewport
    const scaleX = vpW / srcW;
    const scaleY = vpH / srcH;
    const scale = Math.min(scaleX, scaleY);

    focusCanvas.width = Math.floor(srcW * scale);
    focusCanvas.height = Math.floor(srcH * scale);

    const ctx = focusCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    try {
        ctx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, focusCanvas.width, focusCanvas.height);
    } catch (e) {
        // Canvas pode não estar pronto
    }
}

// Atualiza o foco periodicamente quando ativo
let focusInterval = null;
function startFocusUpdates() {
    stopFocusUpdates();
    focusInterval = setInterval(() => {
        if (state.currentView === "focus" && state.connected) {
            updateFocusView();
        }
    }, 100); // ~10fps
}
function stopFocusUpdates() {
    if (focusInterval) {
        clearInterval(focusInterval);
        focusInterval = null;
    }
}

// ─── Atalhos de Teclado ──────────────────────────

const KEY_MAP = {
    ctrl: "ControlLeft", shift: "ShiftLeft", alt: "AltLeft",
    meta: "MetaLeft", enter: "Enter", escape: "Escape",
    tab: "Tab", backspace: "Backspace", delete: "Delete",
    grave: "Backquote", space: "Space",
};

const KEYSYM_MAP = {
    ControlLeft: 0xFFE3, ControlRight: 0xFFE4,
    ShiftLeft: 0xFFE1, ShiftRight: 0xFFE2,
    AltLeft: 0xFFE9, AltRight: 0xFFEA,
    MetaLeft: 0xFFE7, MetaRight: 0xFFE8,
    Enter: 0xFF0D, Escape: 0xFF1B,
    Tab: 0xFF09, Backspace: 0xFF08,
    Delete: 0xFFFF, Space: 0x0020,
    Backquote: 0x0060,
};

function sendKeyCombo(keysStr) {
    if (!state.rfb || !state.connected) return;

    const keys = keysStr.split("+").map(k => k.trim().toLowerCase());
    const xkeys = keys.map(k => {
        if (KEY_MAP[k]) return KEY_MAP[k];
        if (k.length === 1) return `Key${k.toUpperCase()}`;
        return k;
    });

    xkeys.forEach(k => state.rfb.sendKey(keysymFromName(k), k, true));
    [...xkeys].reverse().forEach(k => state.rfb.sendKey(keysymFromName(k), k, false));
}

function keysymFromName(name) {
    if (KEYSYM_MAP[name]) return KEYSYM_MAP[name];
    if (name.startsWith("Key")) return name.charCodeAt(3);
    return 0;
}

// ─── Teclado Virtual ─────────────────────────────

function setupKeyboardInput() {
    $("#btn-keyboard").addEventListener("click", () => {
        els.hiddenInput.focus();
        els.hiddenInput.click();
    });

    els.hiddenInput.addEventListener("input", (e) => {
        if (!state.rfb || !state.connected) return;
        if (e.data) {
            for (const char of e.data) {
                const code = char.charCodeAt(0);
                state.rfb.sendKey(code, null, true);
                state.rfb.sendKey(code, null, false);
            }
        }
        els.hiddenInput.value = "";
    });

    els.hiddenInput.addEventListener("keydown", (e) => {
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
    const settings = {
        high:   { q: 9, c: 0 },
        medium: { q: 5, c: 4 },
        low:    { q: 1, c: 9 },
        auto:   { q: 6, c: 2 },
    };
    const s = settings[level] || settings.auto;
    state.rfb.qualityLevel = s.q;
    state.rfb.compressionLevel = s.c;
}

// ─── UI Controls ─────────────────────────────────

function togglePanel(show) {
    const visible = show !== undefined ? show : els.sidePanel.classList.contains("hidden");
    els.sidePanel.classList.toggle("hidden", !visible);
    els.panelOverlay.classList.toggle("hidden", !visible);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

function toggleMouseMode() {
    state.touchMode = state.touchMode === "touchpad" ? "direct" : "touchpad";
    $("#btn-mouse-mode").classList.toggle("direct-mode", state.touchMode === "direct");
    if (state.rfb) {
        state.rfb.clipViewport = state.touchMode === "touchpad";
        state.rfb.dragViewport = state.touchMode === "touchpad";
    }
    const radio = $(`input[name="touch-mode"][value="${state.touchMode}"]`);
    if (radio) radio.checked = true;
}

// ─── Event Listeners ─────────────────────────────

function setupEventListeners() {
    // Conexão
    $("#btn-connect").addEventListener("click", connect);
    $("#vnc-password").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
    $("#btn-disconnect").addEventListener("click", disconnect);

    // View tabs
    $$(".view-tab").forEach(tab => {
        tab.addEventListener("click", () => switchView(tab.dataset.view));
    });

    // Focus area buttons
    $$(".focus-area-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            $$(".focus-area-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.focusArea = btn.dataset.area;
            updateFocusView();
        });
    });

    // Menu / Painel
    $("#btn-menu").addEventListener("click", () => togglePanel());
    $("#btn-close-panel").addEventListener("click", () => togglePanel(false));
    els.panelOverlay.addEventListener("click", () => togglePanel(false));

    // Fullscreen
    $("#btn-fullscreen").addEventListener("click", toggleFullscreen);

    // Shortcuts
    $("#btn-toggle-shortcuts").addEventListener("click", () => {
        els.shortcutBar.classList.toggle("collapsed");
    });
    $$(".shortcut-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            if (btn.dataset.keys) sendKeyCombo(btn.dataset.keys);
        });
    });

    // Quick actions (chat view)
    $$(".quick-action-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            if (btn.dataset.shortcut) {
                sendKeyCombo(btn.dataset.shortcut);
                switchView("desktop");
            }
        });
    });

    // Chat voice buttons
    const btnChatMic = $("#btn-chat-mic");
    if (btnChatMic) {
        btnChatMic.addEventListener("click", () => {
            $("#voice-panel").classList.remove("hidden");
            $("#tts-panel").classList.add("hidden");
            if (state.voice) state.voice.startListening();
        });
    }
    const btnChatTts = $("#btn-chat-tts");
    if (btnChatTts) {
        btnChatTts.addEventListener("click", () => {
            $("#tts-panel").classList.remove("hidden");
            $("#voice-panel").classList.add("hidden");
            if (state.voice) state.voice.stopListening();
        });
    }

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

    // Viewport
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

    // Voz (STT + TTS)
    setupVoice();

    // Prevenir zoom do browser
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => { if (state.connected) e.preventDefault(); });

    // Focus updates
    startFocusUpdates();
}

// ─── Voz (STT + TTS) ─────────────────────────────

function setupVoice() {
    state.voice = new VoiceModule();

    const btnMic = $("#btn-mic");
    const btnTts = $("#btn-tts");
    const voicePanel = $("#voice-panel");
    const ttsPanel = $("#tts-panel");
    const indicator = $("#voice-indicator");
    const transcriptText = $("#transcript-text");
    const btnVoiceSend = $("#btn-voice-send");
    const btnVoiceClear = $("#btn-voice-clear");
    const voiceAutoSend = $("#voice-auto-send");
    const voiceLang = $("#voice-lang");

    // Callback de transcrição
    state.voice.onTranscript = (text, isFinal) => {
        if (isFinal) {
            state.lastTranscript = text;
            transcriptText.textContent = text;
            transcriptText.className = "";
            btnVoiceSend.disabled = false;

            // Auto-enviar se habilitado
            if (voiceAutoSend.checked) {
                sendTranscriptToKiro(text);
            }
        } else {
            transcriptText.textContent = text;
            transcriptText.className = "transcript-interim";
        }
    };

    // Callback de estado
    state.voice.onStateChange = (voiceState) => {
        switch (voiceState) {
            case "listening":
                btnMic.classList.add("listening");
                indicator.classList.add("active");
                $("#voice-status-text").textContent = "Ouvindo... fale agora";
                break;
            case "speaking":
                btnTts.classList.add("speaking");
                $("#btn-tts-stop").disabled = false;
                $("#btn-tts-play").disabled = true;
                break;
            case "idle":
                btnMic.classList.remove("listening");
                indicator.classList.remove("active");
                btnTts.classList.remove("speaking");
                $("#voice-status-text").textContent = "Toque no microfone para falar";
                $("#btn-tts-stop").disabled = true;
                $("#btn-tts-play").disabled = false;
                break;
            case "denied":
                $("#voice-status-text").textContent = "Permissão de microfone negada";
                btnMic.classList.remove("listening");
                break;
            case "no-speech":
                $("#voice-status-text").textContent = "Nenhuma fala detectada. Tente novamente.";
                btnMic.classList.remove("listening");
                indicator.classList.remove("active");
                break;
            case "unsupported":
                $("#voice-status-text").textContent = "Navegador não suporta reconhecimento de voz";
                break;
            case "error":
                $("#voice-status-text").textContent = "Erro no reconhecimento. Tente novamente.";
                btnMic.classList.remove("listening");
                indicator.classList.remove("active");
                break;
        }
    };

    // Botão microfone — abre painel e começa a ouvir
    btnMic.addEventListener("click", () => {
        if (voicePanel.classList.contains("hidden")) {
            voicePanel.classList.remove("hidden");
            ttsPanel.classList.add("hidden");
            state.voice.startListening();
        } else {
            state.voice.toggleListening();
        }
    });

    // Fechar painel de voz
    $("#btn-close-voice").addEventListener("click", () => {
        voicePanel.classList.add("hidden");
        state.voice.stopListening();
    });

    // Enviar transcrição manualmente
    btnVoiceSend.addEventListener("click", () => {
        if (state.lastTranscript) {
            sendTranscriptToKiro(state.lastTranscript);
        }
    });

    // Limpar transcrição
    btnVoiceClear.addEventListener("click", () => {
        state.lastTranscript = "";
        transcriptText.textContent = "Sua fala aparecerá aqui...";
        transcriptText.className = "transcript-placeholder";
        btnVoiceSend.disabled = true;
    });

    // Idioma
    voiceLang.addEventListener("change", (e) => {
        state.voice.setLanguage(e.target.value);
    });

    // Indicador clicável para toggle
    indicator.addEventListener("click", () => {
        state.voice.toggleListening();
    });

    // ─── TTS ─────────────────────────────────────

    btnTts.addEventListener("click", () => {
        if (ttsPanel.classList.contains("hidden")) {
            ttsPanel.classList.remove("hidden");
            voicePanel.classList.add("hidden");
            state.voice.stopListening();
        } else {
            ttsPanel.classList.add("hidden");
        }
    });

    $("#btn-close-tts").addEventListener("click", () => {
        ttsPanel.classList.add("hidden");
        state.voice.stopSpeaking();
    });

    $("#btn-tts-play").addEventListener("click", () => {
        const text = $("#tts-text").value.trim();
        if (text) {
            state.voice.speak(text, voiceLang.value);
        }
    });

    $("#btn-tts-stop").addEventListener("click", () => {
        state.voice.stopSpeaking();
    });

    $("#btn-tts-paste").addEventListener("click", async () => {
        try {
            const text = await navigator.clipboard.readText();
            $("#tts-text").value = text;
        } catch (e) {
            // Fallback
            $("#tts-text").focus();
        }
    });
}

function sendTranscriptToKiro(text) {
    if (!state.rfb || !state.connected || !text) return;

    // Envia cada caractere como keypress pro VNC
    for (const char of text) {
        const code = char.charCodeAt(0);
        state.rfb.sendKey(code, null, true);
        state.rfb.sendKey(code, null, false);
    }

    // Feedback visual
    const transcriptText = $("#transcript-text");
    transcriptText.textContent = `✓ Enviado: "${text}"`;
    transcriptText.style.color = "var(--green)";
    setTimeout(() => {
        transcriptText.style.color = "";
    }, 2000);
}

// ─── Init ────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    console.log("[Kiro Mobile Bridge] v1.1 Pronto!");
});
