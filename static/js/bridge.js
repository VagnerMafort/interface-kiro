/**
 * Kiro Mobile Bridge v2.0 - Interface estilo ChatGPT
 */

const RFB = window.RFB;
import { VoiceModule } from "./voice.js";

const state = {
    rfb: null,
    connected: false,
    currentView: "desktop",
    quality: "auto",
    voice: null,
    lastTranscript: "",
    focusArea: "editor",
    focusRegions: {
        editor:   { x: 0.20, y: 0.06, w: 0.55, h: 0.65 },
        explorer: { x: 0.00, y: 0.06, w: 0.20, h: 0.94 },
        terminal: { x: 0.20, y: 0.71, w: 0.80, h: 0.29 },
        chat:     { x: 0.75, y: 0.06, w: 0.25, h: 0.65 },
    },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ─── Conexão ─────────────────────────────────────

function connect() {
    const host = $("#vnc-host").value.trim();
    const port = $("#vnc-port").value.trim();
    const password = $("#vnc-password").value;
    if (!host || !port) return showStatus("Preencha host e porta", "error");

    showStatus("Conectando...", "info");
    $("#btn-connect").disabled = true;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    try {
        $("#vnc-screen").innerHTML = "";
        state.rfb = new RFB($("#vnc-screen"), `${proto}://${host}:${port}`, {
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

        state.rfb.addEventListener("connect", () => {
            state.connected = true;
            showStatus("Conectado!", "success");
            switchScreen("main");
            $("#loading-overlay").classList.add("hidden");
            applyQuality(state.quality);
        });
        state.rfb.addEventListener("disconnect", (e) => {
            state.connected = false;
            if (!e.detail.clean) showStatus("Conexão perdida", "error");
            switchScreen("connect");
            $("#btn-connect").disabled = false;
        });
        state.rfb.addEventListener("credentialsrequired", () => {
            if (state.rfb && password) state.rfb.sendCredentials({ password });
        });
    } catch (err) {
        showStatus(`Erro: ${err.message}`, "error");
        $("#btn-connect").disabled = false;
    }
}

function disconnect() {
    if (state.rfb) { state.rfb.disconnect(); state.rfb = null; }
    state.connected = false;
    switchScreen("connect");
}

// ─── Telas e Views ───────────────────────────────

function switchScreen(name) {
    $("#connect-screen").classList.toggle("active", name === "connect");
    $("#main-screen").classList.toggle("active", name === "main");
}

function switchView(view) {
    state.currentView = view;
    $$(".sidebar-item[data-view]").forEach(i => i.classList.toggle("active", i.dataset.view === view));
    $$(".view").forEach(v => v.classList.remove("active"));
    $(`#view-${view}`).classList.add("active");
    const titles = { desktop: "Desktop Remoto", focus: "Modo Foco", actions: "Ações Rápidas" };
    $("#topbar-title").textContent = titles[view] || "";
    closeSidebar();
    if (view === "focus") updateFocusView();
}

function showStatus(msg, type = "") {
    const el = $("#connect-status");
    el.textContent = msg;
    el.className = `connect-status ${type}`;
}

// ─── Sidebar ─────────────────────────────────────

function openSidebar() {
    $(".sidebar").classList.add("open");
    $("#sidebar-overlay").classList.remove("hidden");
}
function closeSidebar() {
    $(".sidebar").classList.remove("open");
    $("#sidebar-overlay").classList.add("hidden");
}

// ─── Tema ────────────────────────────────────────

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.dataset.theme === "dark";
    html.dataset.theme = isDark ? "light" : "dark";
    $("#theme-label").textContent = isDark ? "Modo Escuro" : "Modo Claro";
    const icon = $("#btn-theme i");
    icon.className = isDark ? "fas fa-sun" : "fas fa-moon";
    localStorage.setItem("kiro-theme", html.dataset.theme);
}

function loadTheme() {
    const saved = localStorage.getItem("kiro-theme");
    if (saved) {
        document.documentElement.dataset.theme = saved;
        $("#theme-label").textContent = saved === "dark" ? "Modo Claro" : "Modo Escuro";
        const icon = $("#btn-theme i");
        icon.className = saved === "dark" ? "fas fa-moon" : "fas fa-sun";
    }
}

// ─── Foco ────────────────────────────────────────

function updateFocusView() {
    if (!state.rfb || !state.connected) return;
    const canvas = $("#vnc-screen canvas");
    if (!canvas) return;
    const r = state.focusRegions[state.focusArea];
    if (!r) return;

    const fc = $("#focus-canvas");
    const vp = $("#focus-viewport");
    const srcX = Math.floor(canvas.width * r.x);
    const srcY = Math.floor(canvas.height * r.y);
    const srcW = Math.floor(canvas.width * r.w);
    const srcH = Math.floor(canvas.height * r.h);
    const scale = Math.min(vp.clientWidth / srcW, vp.clientHeight / srcH);

    fc.width = Math.floor(srcW * scale);
    fc.height = Math.floor(srcH * scale);
    const ctx = fc.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    try { ctx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, fc.width, fc.height); } catch(e) {}
}

let focusTimer = setInterval(() => {
    if (state.currentView === "focus" && state.connected) updateFocusView();
}, 100);

// ─── Atalhos ─────────────────────────────────────

const KEYMAP = {
    ctrl:"ControlLeft", shift:"ShiftLeft", alt:"AltLeft", meta:"MetaLeft",
    enter:"Enter", escape:"Escape", tab:"Tab", backspace:"Backspace",
    delete:"Delete", grave:"Backquote", space:"Space",
};
const KEYSYM = {
    ControlLeft:0xFFE3, ShiftLeft:0xFFE1, AltLeft:0xFFE9, MetaLeft:0xFFE7,
    Enter:0xFF0D, Escape:0xFF1B, Tab:0xFF09, Backspace:0xFF08,
    Delete:0xFFFF, Space:0x0020, Backquote:0x0060,
};

function sendKeys(str) {
    if (!state.rfb || !state.connected) return;
    const keys = str.split("+").map(k => KEYMAP[k.trim().toLowerCase()] || `Key${k.trim().toUpperCase()}`);
    keys.forEach(k => state.rfb.sendKey(KEYSYM[k] || k.charCodeAt(3), k, true));
    [...keys].reverse().forEach(k => state.rfb.sendKey(KEYSYM[k] || k.charCodeAt(3), k, false));
}

function sendText(text) {
    if (!state.rfb || !state.connected || !text) return;
    for (const c of text) {
        const code = c.charCodeAt(0);
        state.rfb.sendKey(code, null, true);
        state.rfb.sendKey(code, null, false);
    }
}

// ─── Qualidade ───────────────────────────────────

function applyQuality(level) {
    if (!state.rfb) return;
    state.quality = level;
    const s = { high:{q:9,c:0}, medium:{q:5,c:4}, low:{q:1,c:9}, auto:{q:6,c:2} }[level] || {q:6,c:2};
    state.rfb.qualityLevel = s.q;
    state.rfb.compressionLevel = s.c;
}

// ─── Teclado Virtual ─────────────────────────────

function setupKeyboard() {
    const input = $("#hidden-keyboard-input");
    $("#btn-keyboard").addEventListener("click", () => { input.focus(); input.click(); });
    input.addEventListener("input", (e) => { if (e.data) sendText(e.data); input.value = ""; });
    input.addEventListener("keydown", (e) => {
        if (["Backspace","Enter","Tab","Escape"].includes(e.key)) {
            e.preventDefault();
            const sym = KEYSYM[e.code || e.key];
            if (sym) { state.rfb.sendKey(sym, e.code, true); state.rfb.sendKey(sym, e.code, false); }
        }
    });
}

// ─── Voz ─────────────────────────────────────────

function setupVoice() {
    state.voice = new VoiceModule();
    const vp = $("#voice-panel");
    const tp = $("#tts-panel");
    const indicator = $("#voice-indicator");
    const txt = $("#transcript-text");
    const btnSend = $("#btn-voice-send");

    state.voice.onTranscript = (text, isFinal) => {
        if (isFinal) {
            state.lastTranscript = text;
            txt.textContent = text;
            txt.className = "";
            btnSend.disabled = false;
            if ($("#voice-auto-send").checked) {
                sendText(text);
                txt.textContent = `✓ "${text}"`;
                txt.style.color = "var(--accent)";
                setTimeout(() => txt.style.color = "", 2000);
            }
        } else {
            txt.textContent = text;
            txt.className = "interim";
        }
    };

    state.voice.onStateChange = (s) => {
        const mic = $("#btn-mic");
        if (s === "listening") { mic.classList.add("listening"); indicator.classList.add("active"); $("#voice-status-text").textContent = "Ouvindo..."; }
        else if (s === "speaking") { $("#btn-tts").classList.add("speaking"); }
        else { mic.classList.remove("listening"); indicator.classList.remove("active"); $("#btn-tts").classList.remove("speaking"); $("#voice-status-text").textContent = "Toque para falar"; }
    };

    $("#btn-mic").addEventListener("click", () => {
        vp.classList.toggle("hidden");
        tp.classList.add("hidden");
        if (!vp.classList.contains("hidden")) state.voice.startListening();
    });
    $("#btn-close-voice").addEventListener("click", () => { vp.classList.add("hidden"); state.voice.stopListening(); });
    indicator.addEventListener("click", () => state.voice.toggleListening());
    btnSend.addEventListener("click", () => { if (state.lastTranscript) sendText(state.lastTranscript); });
    $("#btn-voice-clear").addEventListener("click", () => { state.lastTranscript = ""; txt.textContent = "Sua fala aparecerá aqui..."; txt.className = "placeholder"; btnSend.disabled = true; });
    $("#voice-lang").addEventListener("change", (e) => state.voice.setLanguage(e.target.value));

    // TTS
    $("#btn-tts").addEventListener("click", () => { tp.classList.toggle("hidden"); vp.classList.add("hidden"); });
    $("#btn-close-tts").addEventListener("click", () => { tp.classList.add("hidden"); state.voice.stopSpeaking(); });
    $("#btn-tts-play").addEventListener("click", () => { const t = $("#tts-text").value.trim(); if (t) state.voice.speak(t); });
    $("#btn-tts-stop").addEventListener("click", () => state.voice.stopSpeaking());
    $("#btn-tts-paste").addEventListener("click", async () => { try { $("#tts-text").value = await navigator.clipboard.readText(); } catch(e) { $("#tts-text").focus(); } });
}

// ─── Event Listeners ─────────────────────────────

function setup() {
    // Conexão
    $("#btn-connect").addEventListener("click", connect);
    $("#vnc-password").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
    $("#btn-disconnect-sidebar").addEventListener("click", disconnect);

    // Sidebar
    $("#btn-sidebar").addEventListener("click", openSidebar);
    $("#btn-close-sidebar").addEventListener("click", closeSidebar);
    $("#sidebar-overlay").addEventListener("click", closeSidebar);

    // Views
    $$(".sidebar-item[data-view]").forEach(btn => {
        btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // Focus tabs
    $$(".focus-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            $$(".focus-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.focusArea = btn.dataset.area;
            updateFocusView();
        });
    });

    // Actions
    $$(".action-card").forEach(btn => {
        btn.addEventListener("click", () => {
            if (btn.dataset.shortcut) { sendKeys(btn.dataset.shortcut); switchView("desktop"); }
        });
    });

    // Quality
    $$(".chip[data-quality]").forEach(btn => {
        btn.addEventListener("click", () => {
            $$(".chip[data-quality]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            applyQuality(btn.dataset.quality);
        });
    });

    // Theme
    $("#btn-theme").addEventListener("click", toggleTheme);
    loadTheme();

    // Fullscreen
    $("#btn-fullscreen-top").addEventListener("click", () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
    });

    // Keyboard & Voice
    setupKeyboard();
    setupVoice();

    // Prevent zoom
    document.addEventListener("gesturestart", (e) => e.preventDefault());
}

document.addEventListener("DOMContentLoaded", setup);
