/**
 * ARIA Card v6.0 — Dashboard Home Assistant
 *
 * Améliorations vs v5 :
 *  - Pipeline HA complet (STT REST → intent+tts WebSocket)
 *  - Détection silence réelle (AudioAnalyser)
 *  - Affichage transcript + réponse ARIA
 *  - Retry automatique (max 3 tentatives)
 *  - Bouton stop propre (sans location.reload)
 *  - État machine robuste
 *  - Compatible iOS / Android / Desktop
 */

const ARIA_DEFAULTS = {
  title:       "ARIA",
  icon:        "◈",
  accent_color:"#00c8ff",
  stt_engine:  "stt.faster_whisper",   // id du moteur STT dans HA
  pipeline:    undefined,             // undefined = pipeline par défaut HA
  timeout_ms:  8000,                  // durée max enregistrement
  silence_ms:  1500,                  // silence avant arrêt auto
  silence_db:  -45,                   // seuil silence en dB
};

// ── États ────────────────────────────────────────────────────────────────────
const STATE = {
  IDLE:       "idle",
  LISTENING:  "listening",
  PROCESSING: "processing",
  SPEAKING:   "speaking",
  ERROR:      "error",
};

const STATE_LABELS = {
  idle:       "SYSTÈME PRÊT",
  listening:  "ÉCOUTE ACTIVE…",
  processing: "TRAITEMENT NEURAL…",
  speaking:   "TRANSMISSION…",
  error:      "ERREUR PIPELINE",
};

const STATE_COLORS = {
  idle:       "#00c8ff",
  listening:  "#38bdf8",
  processing: "#a855f7",
  speaking:   "#22c55e",
  error:      "#ff4466",
};

// ─────────────────────────────────────────────────────────────────────────────
class AriaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._state      = STATE.IDLE;
    this._transcript = "";
    this._response   = "";
    this._retries    = 0;
    this._maxRetries = 3;

    // Audio
    this._audioCtx       = null;
    this._analyser       = null;
    this._recorder       = null;
    this._stream         = null;
    this._silenceTimer   = null;
    this._recordTimer    = null;
    this._pipelineWs     = null;
  }

  // ── HA API ────────────────────────────────────────────────────────────────
  setConfig(cfg) {
    this._cfg = { ...ARIA_DEFAULTS, ...cfg };
    // Couleur accent override par state color au moment du render
    this._render();
  }

  set hass(h) { this._hass = h; }

  getCardSize() { return 4; }

  static getConfigElement() {
    return document.createElement("aria-card-editor");
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  _render() {
    const color   = STATE_COLORS[this._state] ?? this._cfg.accent_color;
    const label   = STATE_LABELS[this._state] ?? "…";
    const isError = this._state === STATE.ERROR;
    const isBusy  = [STATE.LISTENING, STATE.PROCESSING, STATE.SPEAKING].includes(this._state);

    this.shadowRoot.innerHTML = `
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet">
      <style>
        :host { display:block; }
        * { box-sizing:border-box; margin:0; padding:0; }

        .card {
          background: radial-gradient(circle at 30% 20%, #0e1b40 0%, #050a1a 100%);
          border-radius:24px; padding:28px 24px;
          border:1px solid ${color}22;
          font-family:'Share Tech Mono', monospace;
          text-align:center; color:#fff;
          box-shadow:0 12px 48px #0008, 0 0 0 1px ${color}11;
          user-select:none;
          transition: border-color .4s;
        }

        /* ── Orbe ── */
        .orb-wrap {
          position:relative; width:110px; height:110px;
          margin:0 auto 20px; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
        }
        .orb-wrap:active { transform:scale(.95); }

        .blob {
          position:absolute; inset:-10px;
          background:${color};
          filter:blur(22px); border-radius:50%;
          opacity:${this._state === STATE.IDLE ? .18 : .35};
          animation: ${this._animName()} ${this._animDuration()} infinite ease-in-out;
          transition: opacity .5s, background .4s;
        }
        .ring {
          position:absolute; inset:0;
          border:2px solid ${color}66; border-radius:50%;
          animation: ${isBusy ? "spin 3s infinite linear" : "none"};
        }
        .core {
          position:relative; z-index:2;
          width:62px; height:62px;
          background:#050a1a; border:2px solid ${color};
          border-radius:50%; display:flex; align-items:center; justify-content:center;
          font-size:28px; color:${color};
          box-shadow:0 0 20px ${color}44, inset 0 0 10px ${color}11;
          transition: all .3s;
        }
        .core.pulse { animation: pulse 1s infinite ease-in-out; }

        /* ── Volume bars (écoute) ── */
        .bars {
          display:flex; align-items:center; justify-content:center;
          gap:3px; height:30px; margin:8px auto;
          opacity:${this._state === STATE.LISTENING ? 1 : 0};
          transition:opacity .3s;
        }
        .bar {
          width:4px; background:${color}; border-radius:2px;
          animation:bar-anim 0.5s infinite ease-in-out;
        }
        .bar:nth-child(1) { animation-delay:0s;    height:8px;  }
        .bar:nth-child(2) { animation-delay:0.1s;  height:16px; }
        .bar:nth-child(3) { animation-delay:0.05s; height:24px; }
        .bar:nth-child(4) { animation-delay:0.15s; height:16px; }
        .bar:nth-child(5) { animation-delay:0.08s; height:8px;  }

        /* ── Textes ── */
        .title  { font-size:1.7em; letter-spacing:6px; color:${color}; text-shadow:0 0 12px ${color}55; }
        .status { font-size:.75em; opacity:.5; margin-top:6px; letter-spacing:2px; min-height:1.2em; }

        .transcript {
          margin-top:14px; padding:10px 14px;
          background:${color}0d; border:1px solid ${color}22; border-radius:12px;
          font-size:.8em; color:${color}cc; text-align:left; line-height:1.5;
          display:${this._transcript ? "block" : "none"};
          word-break:break-word;
        }
        .transcript .label { font-size:.7em; opacity:.5; margin-bottom:4px; letter-spacing:1px; }

        .response {
          margin-top:10px; padding:10px 14px;
          background:#ffffff08; border:1px solid #ffffff11; border-radius:12px;
          font-size:.8em; color:#ffffffbb; text-align:left; line-height:1.5;
          display:${this._response ? "block" : "none"};
          word-break:break-word;
        }
        .response .label { font-size:.7em; opacity:.5; margin-bottom:4px; letter-spacing:1px; }

        /* ── Boutons ── */
        .actions {
          display:flex; gap:10px; justify-content:center; margin-top:14px;
        }
        .btn {
          padding:7px 18px; border-radius:20px; border:1px solid ${color}44;
          background:${color}11; color:${color}; font-family:inherit;
          font-size:.75em; letter-spacing:1px; cursor:pointer;
          transition:all .2s;
        }
        .btn:hover { background:${color}22; border-color:${color}88; }
        .btn.stop  { border-color:#ff446644; color:#ff4466; background:#ff446611; }
        .btn.retry { border-color:#f59e0b44; color:#f59e0b; background:#f59e0b11; }

        /* ── Animations ── */
        @keyframes morph {
          0%,100%{ border-radius:45% 55% 50% 50%/50% 50% 45% 55%; }
          33%    { border-radius:55% 45% 60% 40%/40% 60% 45% 55%; }
          66%    { border-radius:40% 60% 45% 55%/55% 45% 60% 40%; }
        }
        @keyframes morph-fast {
          0%,100%{ border-radius:45% 55% 50% 50%/50% 50% 45% 55%; transform:scale(1);   }
          50%    { border-radius:55% 45% 60% 40%/40% 60% 45% 55%; transform:scale(1.1); }
        }
        @keyframes spin { to{ transform:rotate(360deg); } }
        @keyframes pulse{ 0%,100%{transform:scale(1);} 50%{transform:scale(1.08);} }
        @keyframes bar-anim {
          0%,100%{ transform:scaleY(1);   }
          50%    { transform:scaleY(2.5); }
        }
      </style>

      <div class="card">
        <div class="orb-wrap" id="orb">
          <div class="blob"></div>
          <div class="ring"></div>
          <div class="core ${this._state === STATE.SPEAKING ? "pulse" : ""}">${this._cfg.icon}</div>
        </div>

        <div class="bars">
          <div class="bar"></div><div class="bar"></div><div class="bar"></div>
          <div class="bar"></div><div class="bar"></div>
        </div>

        <div class="title">${this._cfg.title}</div>
        <div class="status" id="status">${label}</div>

        <div class="transcript">
          <div class="label">VOUS AVEZ DIT</div>
          ${this._escHtml(this._transcript)}
        </div>

        <div class="response">
          <div class="label">ARIA</div>
          ${this._escHtml(this._response)}
        </div>

        <div class="actions">
          ${isBusy ? `<button class="btn stop" id="btn-stop">■ STOP</button>` : ""}
          ${isError ? `<button class="btn retry" id="btn-retry">↺ RÉESSAYER</button>` : ""}
          ${isError ? `<button class="btn" id="btn-reset">✕ RESET</button>` : ""}
        </div>
      </div>
    `;

    this.shadowRoot.getElementById("orb")?.addEventListener("click", () => this._onOrbClick());
    this.shadowRoot.getElementById("btn-stop")?.addEventListener("click",  (e) => { e.stopPropagation(); this._stop(); });
    this.shadowRoot.getElementById("btn-retry")?.addEventListener("click", (e) => { e.stopPropagation(); this._retry(); });
    this.shadowRoot.getElementById("btn-reset")?.addEventListener("click", (e) => { e.stopPropagation(); this._reset(); });
  }

  _animName()     { return this._state === STATE.LISTENING ? "morph-fast" : "morph"; }
  _animDuration() { return this._state === STATE.LISTENING ? "1.5s" : "4s"; }
  _escHtml(s)     { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // ── Contrôles ─────────────────────────────────────────────────────────────
  async _onOrbClick() {
    if (this._state === STATE.IDLE) {
      this._retries = 0;
      await this._startSession();
    } else if (this._state === STATE.LISTENING) {
      this._stopRecording();
    }
  }

  _stop() {
    this._stopRecording();
    this._cancelPipeline();
    this._reset();
  }

  _reset() {
    this._transcript = "";
    this._response   = "";
    this._setState(STATE.IDLE);
  }

  async _retry() {
    if (this._retries < this._maxRetries) {
      this._retries++;
      this._transcript = "";
      this._response   = "";
      await this._startSession();
    } else {
      this._setState(STATE.ERROR);
      this._updateStatus(`Échec après ${this._maxRetries} tentatives`);
    }
  }

  // ── Session audio ─────────────────────────────────────────────────────────
  async _startSession() {
    try {
      this._setState(STATE.LISTENING);

      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate:        16000,
          channelCount:      1,
          echoCancellation:  true,
          noiseSuppression:  true,
          autoGainControl:   true,
        },
      });

      // Initialiser AudioContext pour détection silence
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const source   = this._audioCtx.createMediaStreamSource(this._stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 256;
      source.connect(this._analyser);

      const chunks = [];
      const mime   = this._bestMimeType();
      this._recorder = new MediaRecorder(this._stream, mime ? { mimeType: mime } : {});
      this._recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      this._recorder.onstop = async () => {
        clearTimeout(this._silenceTimer);
        clearTimeout(this._recordTimer);
        this._releaseMic();
        this._setState(STATE.PROCESSING);
        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        await this._runPipeline(blob);
      };

      this._recorder.start(200);
      this._startSilenceDetection();

      // Garde-fou : arrêt automatique après timeout
      this._recordTimer = setTimeout(() => this._stopRecording(), this._cfg.timeout_ms);

    } catch (err) {
      console.error("ARIA STT:", err);
      this._setState(STATE.ERROR);
      this._updateStatus(err.name === "NotAllowedError" ? "Microphone refusé" : err.message);
    }
  }

  _startSilenceDetection() {
    const data = new Float32Array(this._analyser?.fftSize ?? 256);
    let silenceStart = null;

    const check = () => {
      if (this._state !== STATE.LISTENING) return;
      this._analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
      const db  = 20 * Math.log10(Math.max(rms, 1e-9));

      if (db < this._cfg.silence_db) {
        if (!silenceStart) silenceStart = Date.now();
        else if (Date.now() - silenceStart > this._cfg.silence_ms) {
          this._stopRecording();
          return;
        }
      } else {
        silenceStart = null;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  _stopRecording() {
    if (this._recorder?.state === "recording") this._recorder.stop();
  }

  _releaseMic() {
    this._stream?.getTracks().forEach((t) => t.stop());
    this._audioCtx?.close().catch(() => {});
    this._stream   = null;
    this._audioCtx = null;
    this._analyser = null;
  }

  _bestMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
  }

  // ── Pipeline HA (WebSocket STT binaire → intent → TTS) ───────────────────
  async _runPipeline(audioBlob) {
    try {
      this._updateStatus("Conversion audio…");
      const pcm = await this._blobToPcm16k(audioBlob);
      this._updateStatus("Transcription…");
      await this._runSttPipeline(pcm);
    } catch (err) {
      console.error("ARIA pipeline:", err);
      this._setState(STATE.ERROR);
      this._updateStatus(err.message || "Erreur pipeline");
    }
  }

  async _blobToPcm16k(blob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const buf  = await blob.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    await ctx.close();
    const data = audio.getChannelData(0);
    const pcm  = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++)
      pcm[i] = Math.max(-32768, Math.min(32767, data[i] * 32767 | 0));
    return pcm;
  }

  _runSttPipeline(pcmData) {
    return new Promise((resolve, reject) => {
      const origin = window.location.origin;
      const wsUrl  = origin.replace(/^http/, "ws") + "/api/websocket";
      const token  = this._hass.auth.accessToken;
      const ws     = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      this._pipelineWs = ws;
      let done = false;

      const finish = (ok, err) => {
        if (done) return;
        done = true;
        try { ws.close(); } catch (_) {}
        this._pipelineWs = null;
        if (ok) resolve(); else reject(err);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        const msg = JSON.parse(ev.data);

        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: token }));
          return;
        }
        if (msg.type === "auth_ok") {
          ws.send(JSON.stringify({
            id: 1, type: "assist_pipeline/run",
            start_stage: "stt", end_stage: "tts",
            input: { sample_rate: 16000 },
            pipeline: this._cfg.pipeline ?? undefined,
          }));
          return;
        }

        const event = msg.event;
        if (!event) return;

        switch (event.type) {
          case "run-start": {
            const hid = event.data?.runner_data?.stt_binary_handler_id;
            if (hid == null) break;
            // Envoyer l'audio PCM par chunks de 2 Ko
            const CHUNK = 2048;
            for (let i = 0; i < pcmData.length; i += CHUNK) {
              const slice = pcmData.slice(i, i + CHUNK);
              const frame = new Uint8Array(1 + slice.byteLength);
              frame[0] = hid;
              frame.set(new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength), 1);
              ws.send(frame.buffer);
            }
            ws.send(new Uint8Array([hid]).buffer); // fin du flux
            break;
          }
          case "stt-end": {
            const text = event.data?.stt_output?.text?.trim();
            if (text) { this._transcript = text; this._render(); }
            else {
              this._setState(STATE.ERROR);
              this._updateStatus("Rien compris — parlez plus fort");
              finish(false, new Error("stt-empty"));
            }
            break;
          }
          case "intent-end": {
            const speech = event.data?.intent_output?.response?.speech?.plain?.speech;
            if (speech) { this._response = speech; this._render(); }
            break;
          }
          case "tts-end": {
            const url = event.data?.tts_output?.url;
            if (url) this._playAudio(url).then(() => finish(true));
            break;
          }
          case "run-end":
            this._setState(STATE.IDLE);
            finish(true);
            break;
          case "error":
            this._setState(STATE.ERROR);
            this._updateStatus(event.data?.message ?? "Erreur assistant");
            finish(false, new Error(event.data?.message));
            break;
        }
      };

      ws.onerror = () => finish(false, new Error("WebSocket erreur"));
    });
  }

  _cancelPipeline() {
    try { this._pipelineWs?.close(); } catch (_) {}
    this._pipelineWs = null;
  }

  // ── Lecture audio ─────────────────────────────────────────────────────────
  async _playAudio(url) {
    return new Promise(async (resolve) => {
      this._setState(STATE.SPEAKING);
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${this._hass.auth.accessToken}` }
        });
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => { ctx.close(); this._setState(STATE.IDLE); resolve(); };
        source.start(0);
      } catch (err) {
        console.error("ARIA audio:", err);
        this._setState(STATE.ERROR);
        this._updateStatus("Erreur lecture audio");
        resolve();
      }
    });
  }

  // ── État ──────────────────────────────────────────────────────────────────
  _setState(s) {
    this._state = s;
    this._render();
  }

  _updateStatus(msg) {
    const el = this.shadowRoot.getElementById("status");
    if (el) el.textContent = msg;
  }
}

customElements.define("aria-card", AriaCard);
