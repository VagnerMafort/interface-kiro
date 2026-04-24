/**
 * Kiro Mobile Bridge - Módulo de Voz
 * Speech-to-Text (microfone → texto → Kiro)
 * Text-to-Speech (resposta do Kiro → áudio)
 */

export class VoiceModule {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.isSpeaking = false;
        this.language = "pt-BR";
        this.onTranscript = null; // callback(text)
        this.onStateChange = null; // callback(state)
        this.continuous = false;
        this.interimResults = true;

        this._initRecognition();
    }

    // ─── Speech-to-Text ──────────────────────────

    _initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("[Voice] Speech Recognition não suportado neste navegador");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = this.language;
        this.recognition.continuous = this.continuous;
        this.recognition.interimResults = this.interimResults;
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            this.isListening = true;
            this._emitState("listening");
        };

        this.recognition.onresult = (event) => {
            let finalTranscript = "";
            let interimTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                } else {
                    interimTranscript += result[0].transcript;
                }
            }

            if (finalTranscript && this.onTranscript) {
                this.onTranscript(finalTranscript.trim(), true);
            } else if (interimTranscript && this.onTranscript) {
                this.onTranscript(interimTranscript.trim(), false);
            }
        };

        this.recognition.onerror = (event) => {
            console.warn("[Voice] Erro:", event.error);
            this.isListening = false;

            if (event.error === "not-allowed") {
                this._emitState("denied");
            } else if (event.error === "no-speech") {
                this._emitState("no-speech");
            } else {
                this._emitState("error");
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            if (this.continuous && this._wantContinuous) {
                // Reinicia automaticamente no modo contínuo
                try { this.recognition.start(); } catch(e) {}
            } else {
                this._emitState("idle");
            }
        };
    }

    startListening(continuous = false) {
        if (!this.recognition) {
            this._emitState("unsupported");
            return false;
        }
        if (this.isListening) {
            this.stopListening();
            return false;
        }

        // Para TTS se estiver falando
        this.stopSpeaking();

        this._wantContinuous = continuous;
        this.recognition.continuous = continuous;

        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.warn("[Voice] Erro ao iniciar:", e);
            return false;
        }
    }

    stopListening() {
        this._wantContinuous = false;
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
        this.isListening = false;
        this._emitState("idle");
    }

    toggleListening() {
        if (this.isListening) {
            this.stopListening();
        } else {
            this.startListening(false);
        }
    }

    // ─── Text-to-Speech ──────────────────────────

    speak(text, lang = null) {
        if (!this.synthesis) {
            console.warn("[Voice] Speech Synthesis não suportado");
            return;
        }

        this.stopSpeaking();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang || this.language;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Tenta usar uma voz brasileira
        const voices = this.synthesis.getVoices();
        const ptVoice = voices.find(v => v.lang.startsWith("pt")) ||
                        voices.find(v => v.lang.startsWith("en"));
        if (ptVoice) utterance.voice = ptVoice;

        utterance.onstart = () => {
            this.isSpeaking = true;
            this._emitState("speaking");
        };

        utterance.onend = () => {
            this.isSpeaking = false;
            this._emitState("idle");
        };

        utterance.onerror = () => {
            this.isSpeaking = false;
            this._emitState("idle");
        };

        this.synthesis.speak(utterance);
    }

    stopSpeaking() {
        if (this.synthesis && this.isSpeaking) {
            this.synthesis.cancel();
            this.isSpeaking = false;
            this._emitState("idle");
        }
    }

    toggleSpeaking(text) {
        if (this.isSpeaking) {
            this.stopSpeaking();
        } else if (text) {
            this.speak(text);
        }
    }

    // ─── Utils ───────────────────────────────────

    setLanguage(lang) {
        this.language = lang;
        if (this.recognition) {
            this.recognition.lang = lang;
        }
    }

    isSupported() {
        return {
            stt: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
            tts: !!window.speechSynthesis,
        };
    }

    _emitState(state) {
        if (this.onStateChange) {
            this.onStateChange(state);
        }
    }
}
