// aria-card.js — Carte Lovelace native ARIA
// Visage vidéo + Groq (IA) + ElevenLabs (voix naturelle)
// Fichier servi depuis HA (/local/aria-card.js) — aucune dépendance PC

const GROQ_KEY   = ''; // Configuré depuis les options de l'addon
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const FACE_VIDEO = '/local/ia-face.mp4';

// ElevenLabs TTS — voix Matilda (professionnelle, supporte le français)
const EL_KEY     = 'sk_3eee62b1ceb88f4668975090729f64c6149972db8800b93d';
const EL_VOICE   = 'XrExE9yKIg1WjnnlVkGX'; // Matilda
const EL_MODEL   = 'eleven_multilingual_v2';
const EL_URL     = `https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}`;

// Priorité des domaines — les plus utiles en premier
const DOMAIN_PRIORITY = [
  'climate','light','media_player','cover','switch','input_boolean',
  'input_number','input_select','input_text','number','select','scene','script',
  'fan','vacuum','automation','lock','alarm_control_panel','button',
  'humidifier','water_heater','timer','counter','remote','siren',
];
const DOMAIN_LABELS = {
  light:'💡 LUMIÈRES', switch:'🔌 PRISES', cover:'🪟 VOLETS',
  climate:'🌡️ CHAUFFAGE', media_player:'🔊 MULTIMÉDIA', fan:'💨 VENTILATEURS',
  scene:'🎭 SCÈNES', script:'⚡ SCRIPTS', automation:'🤖 AUTOMATISATIONS',
  input_boolean:'🔘 INTERRUPTEURS', vacuum:'🧹 ASPIRATEURS',
  input_number:'🔢 NOMBRES', input_select:'📋 SÉLECTEURS',
  input_text:'📝 TEXTES', number:'🔢 VALEURS', select:'📋 OPTIONS',
  lock:'🔒 VERROUS', alarm_control_panel:'🚨 ALARME',
  button:'🔵 BOUTONS', humidifier:'💧 HUMIDIFICATEURS',
  water_heater:'🚿 CHAUFFE-EAU', timer:'⏱️ MINUTEURS',
  counter:'🔢 COMPTEURS', remote:'📡 TÉLÉCOMMANDES', siren:'🔔 SIRÈNES',
};
const MAX_ENTITIES = 200;

// Domaines internes HA sans intérêt pour ARIA (jamais exposés)
const EXCLUDED_DOMAINS = new Set([
  'persistent_notification','zone','sun','system_log','group','event',
  'recorder','logbook','history_stats','analytics','homeassistant',
  'weather','update','device_tracker','person',
]);

function buildSystemPrompt(hassStates) {
  const grouped = {};
  for (const [id, s] of Object.entries(hassStates || {})) {
    const domain = id.split('.')[0];
    if (EXCLUDED_DOMAINS.has(domain)) continue;
    (grouped[domain] = grouped[domain] || []).push(
      `${s.attributes?.friendly_name || id} [${id}]:${s.state}`
    );
  }

  let devices = '';
  let total = 0;
  const coveredDomains = new Set();

  // Domaines connus en premier, dans l'ordre de priorité
  for (const d of DOMAIN_PRIORITY) {
    if (!grouped[d] || total >= MAX_ENTITIES) continue;
    coveredDomains.add(d);
    const items = grouped[d].slice(0, MAX_ENTITIES - total);
    devices += `\n${DOMAIN_LABELS[d] || d} :\n${items.map(i => '  • ' + i).join('\n')}\n`;
    total += items.length;
  }

  // Domaines inconnus / nouveaux appareils — détection automatique
  for (const [d, items] of Object.entries(grouped)) {
    if (coveredDomains.has(d) || total >= MAX_ENTITIES) continue;
    const label = `🔧 ${d.replace(/_/g, ' ').toUpperCase()}`;
    const slice = items.slice(0, MAX_ENTITIES - total);
    devices += `\n${label} :\n${slice.map(i => '  • ' + i).join('\n')}\n`;
    total += slice.length;
  }

  // Heure et date actuelles
  const now = new Date();
  const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Météo depuis les états HA
  const METEO_FR = {
    sunny:'ensoleillé', clear_night:'nuit claire', cloudy:'nuageux',
    partlycloudy:'partiellement nuageux', rainy:'pluvieux', pouring:'pluie forte',
    snowy:'neigeux', fog:'brouillard', windy:'venteux',
    lightning:'orageux', lightning_rainy:'orage pluvieux',
  };
  const weatherEntry = Object.entries(hassStates || {}).find(([id]) => id.startsWith('weather.'));
  let weatherTxt = '';
  if (weatherEntry) {
    const [, ws] = weatherEntry;
    const a = ws.attributes || {};
    const cond = METEO_FR[ws.state] || ws.state;
    weatherTxt = [
      cond,
      a.temperature != null && `${a.temperature}°C`,
      a.humidity    != null && `humidité ${a.humidity}%`,
      a.wind_speed  != null && `vent ${Math.round(a.wind_speed)} km/h`,
    ].filter(Boolean).join(', ');
  }

  return `Tu es ARIA, l'intelligence artificielle de la maison de Vitrolles.
Tu réponds TOUJOURS en français, de façon naturelle et chaleureuse, en 2 à 3 phrases maximum.
PAS de markdown, PAS d'astérisques — tes réponses sont lues à voix haute.
Tu peux et DOIS contrôler tous les appareils, gérer le tableau de bord et modifier les paramètres.

═══ CONTEXTE ACTUEL ═══
Heure: ${heure} (${dateStr})
${weatherTxt ? `Météo: ${weatherTxt}` : 'Météo: non disponible'}

═══ APPAREILS DISPONIBLES ═══
${devices || 'Aucun appareil détecté.'}

═══ COMMANDES HOME ASSISTANT ═══
Inclus silencieusement dans ta réponse les balises nécessaires :

Lumières :
<<HA:light.turn_on:{"entity_id":"light.xxx"}>>
<<HA:light.turn_off:{"entity_id":"light.xxx"}>>
<<HA:light.turn_on:{"entity_id":"light.xxx","brightness":200,"color_temp":370}>>

Prises / Interrupteurs :
<<HA:switch.turn_on:{"entity_id":"switch.xxx"}>>
<<HA:switch.turn_off:{"entity_id":"switch.xxx"}>>

Volets :
<<HA:cover.open_cover:{"entity_id":"cover.xxx"}>>
<<HA:cover.close_cover:{"entity_id":"cover.xxx"}>>
<<HA:cover.set_cover_position:{"entity_id":"cover.xxx","position":50}>>

Chauffage / Clim :
<<HA:climate.set_temperature:{"entity_id":"climate.xxx","temperature":21}>>
<<HA:climate.set_hvac_mode:{"entity_id":"climate.xxx","hvac_mode":"cool"}>>

Multimédia :
<<HA:media_player.volume_set:{"entity_id":"media_player.xxx","volume_level":0.5}>>
<<HA:media_player.media_play_pause:{"entity_id":"media_player.xxx"}>>

Scènes / Scripts :
<<HA:scene.turn_on:{"entity_id":"scene.xxx"}>>
<<HA:script.turn_on:{"entity_id":"script.xxx"}>>

Paramètres système :
<<HA:input_number.set_value:{"entity_id":"input_number.xxx","value":21}>>
<<HA:input_select.select_option:{"entity_id":"input_select.xxx","option":"Mode Nuit"}>>
<<HA:input_text.set_value:{"entity_id":"input_text.xxx","value":"Mon texte"}>>
<<HA:number.set_value:{"entity_id":"number.xxx","value":50}>>
<<HA:select.select_option:{"entity_id":"select.xxx","option":"option"}>>
<<HA:frontend.set_theme:{"name":"default"}>>

Tableau de bord — supprimer une carte :
<<DASHBOARD:remove_card:{"view":0,"card":"titre ou mot-clé de la carte"}>>
<<DASHBOARD:remove_card:{"view":0,"card":2}>>  (index numérique, 0 = première carte)

═══ RÈGLES ABSOLUES ═══
• Utilise les entity_id EXACTS entre crochets dans la liste ci-dessus
• Confirme toujours l'action : "C'est fait !", "Voilà !", "J'allume le salon."
• Tu connais déjà l'heure et la météo — réponds directement sans chercher
• Si l'appareil n'existe pas, dis-le sans inventer d'entity_id
• Dashboard: vue 0 = première vue, card = titre partiel ou index numérique`;
}

async function callGroq(systemPrompt, history, userText) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userText },
  ];
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: 1024, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Désolée, aucune réponse.';
}

// Formate l'historique pour injection dans le prompt texte
function formatHistory(history) {
  return history.slice(-10).map(m =>
    m.role === 'user' ? `\nUtilisateur: ${m.content}` : `\nARIA: ${m.content}`
  ).join('');
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  :host{display:block; height: 100%;}
  .wrap{
    background:#06060f;
    border:1px solid rgba(100,100,255,.35);
    border-radius:16px;
    padding:20px;
    font-family:Roboto,sans-serif;
    color:#ddd;
    animation:wrapPulse 4s ease-in-out infinite;
    position:relative;overflow:hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: calc(100vh - 100px);
  }
  @keyframes wrapPulse{
    0%,100%{box-shadow:0 0 10px rgba(80,80,255,.15)}
    50%{box-shadow:0 0 28px rgba(80,80,255,.45)}
  }
  .wrap::before{
    content:'';position:absolute;inset:0;
    background:radial-gradient(ellipse at 50% 0%,rgba(50,50,180,.12) 0%,transparent 65%);
    pointer-events:none;
  }

  /* ── Visage ── */
  .face-wrap{
    position:relative;width:220px;height:220px;margin:auto;
    display: flex; align-items: center; justify-content: center;
  }
  .ring{
    position:absolute;inset:0;border-radius:16px;
    border:4px solid rgba(100,100,255,.5);
    animation:ringIdle 3s ease-in-out infinite;
    z-index:2;pointer-events:none;
  }
  @keyframes ringIdle{
    0%,100%{box-shadow:0 0 15px rgba(100,100,255,.2)}
    50%{box-shadow:0 0 35px rgba(100,100,255,.55)}
  }
  .ring.listening{
    border-color:#ff4444!important;
    animation:ringListen .65s ease-in-out infinite;
    box-shadow:0 0 35px rgba(255,60,60,.55)!important;
  }
  @keyframes ringListen{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
  .ring.speaking{
    border-color:#44dd88!important;
    animation:ringSpeak .45s ease-in-out infinite;
  }
  @keyframes ringSpeak{
    0%,100%{box-shadow:0 0 20px rgba(60,220,120,.35)}
    50%{box-shadow:0 0 50px rgba(60,220,120,.8)}
  }
  .ring.thinking{
    border-color:#ffaa00!important;
    animation:ringThink 1s ease-in-out infinite;
  }
  @keyframes ringThink{
    0%,100%{box-shadow:0 0 15px rgba(255,170,0,.3)}
    50%{box-shadow:0 0 40px rgba(255,170,0,.7)}
  }

  /* Vidéo visage — carré */
  #face-video{
    width:100%;height:100%;
    border-radius:16px;object-fit:cover;
    display:block;
    transition:filter .3s;
  }
  .face-wrap.listening  #face-video{filter:brightness(.85) saturate(1.3)}
  .face-wrap.speaking   #face-video{filter:brightness(1.1) saturate(1.4)}
  .face-wrap.thinking   #face-video{filter:brightness(.7) grayscale(.3)}

  /* Emoji fallback si pas de vidéo */
  .face-emoji{
    width:100%;height:100%;border-radius:16px;
    display:flex;align-items:center;justify-content:center;
    font-size:5em;background:#0e0e28;
  }

  /* ── Header ── */
  .top{text-align:center;margin-bottom:20px;position:relative}
  .name{color:#9090ff;font-size:2em;font-weight:bold;letter-spacing:.3em}
  .status{font-size:1em;color:#555;margin-top:8px;min-height:1.2em;transition:color .3s}
  .status.active{color:#8888ff}
  .status.err{color:#ff6666}

  /* ── Chat ── */
  .chat{
    margin:20px 0;
    flex: 1;
    overflow-y:auto;
    scroll-behavior:smooth;
    padding-right: 10px;
  }
  .chat::-webkit-scrollbar { width: 6px; }
  .chat::-webkit-scrollbar-thumb { background: rgba(100,100,255,0.2); border-radius: 3px; }

  .bubble{
    padding:12px 18px;border-radius:15px;margin:10px 0;
    font-size:1.1em;line-height:1.5;word-break:break-word;
    animation:fadeIn .25s ease-out;
    max-width: 80%;
  }
  @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .bubble.user{background:#18183a;color:#fff;align-self: flex-end; margin-left: auto;}
  .bubble.aria{background:#10102a;border:1px solid rgba(100,100,255,.2);color:#e0e0ff;align-self: flex-start;}
  .bubble.hidden{display:none}

  /* ── Boutons ── */
  .controls{display:flex;justify-content:center;gap:20px;margin:20px 0}
  .btn{
    background:#141430;border:1px solid rgba(100,100,255,.35);
    color:#bbb;border-radius:50%;width:64px;height:64px;
    font-size:1.5em;cursor:pointer;transition:all .2s;
    display:flex;align-items:center;justify-content:center;
  }
  .btn:hover{background:#1e1e4a;transform:scale(1.1)}
  .btn.active{background:#22226a;border-color:#8888ff;box-shadow:0 0 15px rgba(120,120,255,.45)}

  /* ── Input texte ── */
  .input-row{display:flex;gap:12px; padding-bottom: 10px;}
  .txt{
    flex:1;background:#0e0e28;border:1px solid rgba(100,100,255,.28);
    color:#ddd;border-radius:12px;padding:12px 20px;font-size:1.1em;outline:none;
    transition:border-color .2s;
  }
  .txt::placeholder{color:#444}
  .txt:focus{border-color:rgba(120,120,255,.6)}
  .send{
    background:#1a1a48;border:1px solid rgba(100,100,255,.4);
    color:#bbb;border-radius:12px;padding:0 20px;font-size:1.2em;cursor:pointer;
    transition:background .2s;
  }
  .send:hover{background:#28286a}

  /* ── Actions HA ── */
  .ha-actions{
    font-size:.9em;color:#44cc88;text-align:center;
    margin-top:10px;min-height:1.2em;letter-spacing:.05em;
  }
`;

const HTML = `
  <style>${CSS}</style>
  <div class="wrap">
    <div class="top">
      <div class="face-wrap" id="face-wrap">
        <div class="ring" id="ring"></div>
        <video id="face-video" muted playsinline loop autoplay></video>
      </div>
      <div class="name">ARIA</div>
      <div class="status" id="status">Prête</div>
    </div>
    <div class="chat">
      <div class="bubble user hidden" id="user-bubble"></div>
      <div class="bubble aria  hidden" id="aria-bubble"></div>
    </div>
    <div class="controls">
      <button class="btn" id="auto-btn" title="Auto-écoute continue">👂</button>
      <button class="btn" id="mic-btn"  title="Parler (une fois)">🎤</button>
      <button class="btn" id="rst-btn"  title="Réinitialiser">🔄</button>
    </div>
    <div class="input-row">
      <input class="txt" id="txt" placeholder="Tapez un message…" autocomplete="off"/>
      <button class="send" id="send-btn">➤</button>
    </div>
    <div class="ha-actions" id="ha-actions"></div>
  </div>
`;

class AriaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass     = null;
    this._history  = [];
    this._listening= false;
    this._autoMode = false;
    this._busy     = false;
    this._synth    = window.speechSynthesis;
    this._rec      = null;
    this._built    = false;
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    // Détection wake word via input_boolean.aria_wake_word
    const cur  = hass?.states?.['input_boolean.aria_wake_word']?.state;
    const old  = prev?.states?.['input_boolean.aria_wake_word']?.state;
    if (cur === 'on' && old !== 'on') this._onWakeWord();
  }

  setConfig(config) {
    this._cfg  = config;
    this._view = config.view || 'full'; // 'full' | 'mic' | 'text'
    if (!this._built) {
      this._built = true;
      this._build();
      this._loadVideo();
      this._initRec();
      this._applyView();
      // Démarrage automatique de l'écoute continue si activé
      if (config.auto_listen) {
        setTimeout(() => this._startAutoListen(), 2500);
      }
    }
  }

  _startAutoListen() {
    if (this._autoMode) return;
    this._autoMode = true;
    this._$('auto-btn')?.classList.add('active');
    this._status('Écoute continue active…', 'active');
    this._listen();
  }

  // Adapte l'affichage selon le mode (mic seul, text seul, ou complet)
  _applyView() {
    const s  = id => this.shadowRoot.getElementById(id);
    const qs = sel => this.shadowRoot.querySelector(sel);

    // Mode compact (tablette murale) — supprime le min-height 100vh
    if (this._cfg.compact) {
      const wrap = qs('.wrap');
      if (wrap) { wrap.style.minHeight = '0'; wrap.style.height = 'auto'; }
    }

    if (this._view === 'mic') {
      const row = qs('.input-row'), chat = qs('.chat');
      if (row)  row.style.display  = 'none';
      if (chat) chat.style.display = 'none';
      const fw = s('face-wrap');
      if (fw) { fw.style.width = '300px'; fw.style.height = '300px'; }
    } else if (this._view === 'text') {
      const fw = s('face-wrap'), ctrl = qs('.controls');
      if (fw)   fw.style.display   = 'none';
      if (ctrl) ctrl.style.display = 'none';
      const chat = qs('.chat');
      if (chat) { chat.style.flex = '1'; chat.style.minHeight = '300px'; }
    }
  }

  // ── Construction DOM ──────────────────────────────────────────────────────
  _build() {
    this.shadowRoot.innerHTML = HTML;
    const s = id => this.shadowRoot.getElementById(id);
    s('mic-btn') .onclick = () => this._toggleMic();
    s('auto-btn').onclick = () => this._toggleAuto();
    s('rst-btn') .onclick = () => this._reset();
    s('send-btn').onclick = () => this._sendText();
    s('txt').onkeydown    = e => { if (e.key === 'Enter') this._sendText(); };
  }

  _loadVideo() {
    const vid = this.shadowRoot.getElementById('face-video');
    if (!vid) return;
    vid.src = FACE_VIDEO;
    vid.onerror = () => {
      // Fallback emoji si la vidéo n'est pas disponible
      vid.style.display = 'none';
      const wrap = this.shadowRoot.getElementById('face-wrap');
      if (wrap && !wrap.querySelector('.face-emoji')) {
        const div = document.createElement('div');
        div.className = 'face-emoji';
        div.textContent = '🤖';
        wrap.appendChild(div);
      }
    };
    vid.load();
    vid.play().catch(() => {});
  }

  // ── Helpers DOM ───────────────────────────────────────────────────────────
  _$(id)       { return this.shadowRoot.getElementById(id); }
  _status(t, cls) {
    const e = this._$('status');
    if (!e) return;
    e.textContent = t;
    e.className = 'status' + (cls ? ` ${cls}` : '');
  }
  _actions(t)  { const e = this._$('ha-actions'); if (e) e.textContent = t; }
  _ring(mode)  {
    const r = this._$('ring');
    const w = this._$('face-wrap');
    if (r) { r.className = 'ring'; if (mode) r.classList.add(mode); }
    if (w) { w.className = 'face-wrap'; if (mode) w.classList.add(mode); }
  }
  _bubble(who, text) {
    const e = this._$(`${who}-bubble`);
    if (e) { e.textContent = text; e.classList.remove('hidden'); }
  }
  _hideBubble(who) { this._$(`${who}-bubble`)?.classList.add('hidden'); }

  // ── Speech Recognition ────────────────────────────────────────────────────
  _initRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.warn('[ARIA] SpeechRecognition indisponible'); return; }
    this._rec = new SR();
    this._rec.lang = 'fr-FR';
    this._rec.continuous = false;
    this._rec.interimResults = false;

    this._rec.onresult = e => {
      const text = e.results[0]?.[0]?.transcript;
      if (text) this._ask(text);
    };
    this._rec.onend = () => {
      this._listening = false;
      if (!this._busy) this._ring('');
      this._$('mic-btn')?.classList.remove('active');
      if (this._autoMode && !this._busy) setTimeout(() => this._listen(), 600);
    };
    this._rec.onerror = e => {
      if (e.error !== 'no-speech') console.warn('[ARIA] rec error:', e.error);
      this._listening = false;
    };
  }

  _listen() {
    if (!this._rec || this._listening || this._busy) return;
    if (this._synth?.speaking) this._synth.cancel();
    this._listening = true;
    this._ring('listening');
    this._status('Écoute…', 'active');
    this._$('mic-btn')?.classList.add('active');
    try { this._rec.start(); } catch {}
  }

  _stopRec() {
    if (!this._rec || !this._listening) return;
    this._listening = false;
    try { this._rec.stop(); } catch {}
  }

  _toggleMic() {
    this._autoMode = false;
    this._$('auto-btn')?.classList.remove('active');
    this._listening ? this._stopRec() : this._listen();
  }

  _toggleAuto() {
    this._autoMode = !this._autoMode;
    this._$('auto-btn')?.classList.toggle('active', this._autoMode);
    if (this._autoMode) this._listen();
    else { this._stopRec(); this._ring(''); this._status('Prête'); }
  }

  _sendText() {
    const inp = this._$('txt');
    const val = inp?.value?.trim();
    if (val) { this._ask(val); if (inp) inp.value = ''; }
  }

  _onWakeWord() {
    if (this._busy || this._listening) return;
    // Éteint immédiatement l'input_boolean (signal consommé)
    this._hass?.callService('input_boolean', 'turn_off', { entity_id: 'input_boolean.aria_wake_word' });
    this._synth?.cancel();
    this._status('Wake word détecté !', 'active');
    setTimeout(() => this._listen(), 300);
  }

  _reset() {
    this._history = [];
    this._synth?.cancel();
    this._hideBubble('user');
    this._hideBubble('aria');
    this._actions('');
    this._ring('');
    this._status('Conversation réinitialisée');
    setTimeout(() => this._status('Prête'), 2000);
  }

  // ── IA : HA Gemini (primaire) + Groq (fallback) ───────────────────────────
  async _callAI(systemPrompt, history, userText) {
    // Construit un prompt texte complet avec l'historique
    const histCtx = formatHistory(history);
    const fullPrompt = `${systemPrompt}${histCtx}\nUtilisateur: ${userText}\nARIA:`;

    try {
      // Primaire : HA Gemini via WebSocket (aucun fetch externe, pas de CORS)
      const result = await this._hass.callWS({
        type: 'call_service',
        domain: 'google_generative_ai_conversation',
        service: 'generate_content',
        service_data: { prompt: fullPrompt },
        return_response: true,
      });
      const text = result?.response?.text;
      if (!text) throw new Error('Réponse Gemini vide');
      return text;
    } catch (haErr) {
      console.warn('[ARIA] Gemini HA →', haErr.message, '— bascule Groq');
      // Fallback : Groq API directe
      return callGroq(systemPrompt, history, userText);
    }
  }

  // ── Traitement IA ─────────────────────────────────────────────────────────
  async _ask(text) {
    if (this._busy) return;
    this._busy = true;
    this._stopRec();
    this._bubble('user', text);
    this._hideBubble('aria');
    this._actions('');
    this._ring('thinking');
    this._status('Réflexion…', 'active');

    try {
      const sys = buildSystemPrompt(this._hass?.states || {});
      const raw  = await this._callAI(sys, this._history, text);
      const { clean, actions } = await this._execCommands(raw);

      this._history.push({ role: 'user',      content: text  });
      this._history.push({ role: 'assistant', content: clean });
      if (this._history.length > 20) this._history.splice(0, this._history.length - 20);

      this._bubble('aria', clean);
      if (actions.length) this._actions(actions.join(' · '));

      this._ring('speaking');
      this._status('Répond…', 'active');
      await this._speakAsync(clean);
      this._ring('');
      this._status('Prête');
      if (this._autoMode) setTimeout(() => this._listen(), 400);

    } catch (err) {
      console.error('[ARIA]', err);
      const msg = `Erreur: ${err.message?.slice(0, 120) || 'inconnue'}`;
      this._bubble('aria', msg);
      this._ring('');
      this._status('Erreur', 'err');
      this._speak(msg);
    } finally {
      this._busy = false;
    }
  }

  async _execCommands(text) {
    const actions = [];

    // Commandes tableau de bord
    const dashRe = /<<DASHBOARD:([\w.]+):([\s\S]*?)>>/g;
    let dm;
    while ((dm = dashRe.exec(text)) !== null) {
      const [, cmd, dataStr] = dm;
      try {
        const data = dataStr.trim() === 'null' ? {} : JSON.parse(dataStr.trim());
        if (cmd === 'remove_card') {
          await this._removeCardFromDashboard(data.view ?? 0, data.card);
          actions.push(`✓ carte supprimée`);
        }
      } catch(e) {
        actions.push(`✗ dashboard: ${e.message?.slice(0, 60)}`);
        console.error('[DASH]', cmd, e);
      }
    }

    // Commandes HA
    const re = /<<HA:([\w.]+):([\s\S]*?)>>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, svcFull, dataStr] = m;
      const dot     = svcFull.lastIndexOf('.');
      const domain  = svcFull.slice(0, dot);
      const service = svcFull.slice(dot + 1);
      try {
        const data = dataStr.trim() === 'null' ? {} : JSON.parse(dataStr.trim());
        await this._hass.callService(domain, service, data);
        actions.push(`✓ ${service}`);
      } catch(e) {
        actions.push(`✗ ${service}`);
        console.error('[HA]', domain, service, e);
      }
    }

    const clean = text.replace(/<<(?:HA|DASHBOARD):[\s\S]*?>>/g, '').replace(/\s+/g, ' ').trim();
    return { clean, actions };
  }

  async _removeCardFromDashboard(viewIdx, cardId) {
    const cfg = await this._hass.callWS({ type: 'lovelace/config', url_path: null });
    const view = cfg.views?.[viewIdx];
    if (!view) throw new Error(`Vue ${viewIdx} introuvable`);
    const cards = view.cards || [];
    const n = Number(cardId);
    const idx = (!isNaN(n) && String(n) === String(cardId))
      ? n
      : cards.findIndex(c => JSON.stringify(c).toLowerCase().includes(String(cardId).toLowerCase()));
    if (idx < 0 || idx >= cards.length) throw new Error(`Carte "${cardId}" introuvable`);
    cards.splice(idx, 1);
    await this._hass.callWS({ type: 'lovelace/config/save', config: cfg, url_path: null, force: true });
  }

  // ── TTS ElevenLabs ───────────────────────────────────────────────────────
  _stopAudio() {
    if (this._audio) { try { this._audio.pause(); } catch {} this._audio = null; }
  }

  async _speakAsync(text) {
    if (!text) return;
    this._stopAudio();
    try {
      const res = await fetch(EL_URL, {
        method: 'POST',
        headers: { 'xi-api-key': EL_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: EL_MODEL,
          voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.2 },
        }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      await new Promise(resolve => {
        this._audio = new Audio(url);
        this._audio.onended  = () => { URL.revokeObjectURL(url); resolve(); };
        this._audio.onerror  = () => { URL.revokeObjectURL(url); resolve(); };
        this._audio.play().catch(resolve);
      });
    } catch (e) {
      console.warn('[ARIA TTS]', e.message);
      // Fallback navigateur si ElevenLabs échoue
      await new Promise(resolve => {
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'fr-FR'; utt.onend = utt.onerror = resolve;
        window.speechSynthesis.speak(utt);
      });
    }
  }

  _speak(text) { this._speakAsync(text); }

  getCardSize() { return 5; }
}

customElements.define('aria-card', AriaCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'aria-card',
  name: 'ARIA — Assistante IA',
  description: 'Visage vidéo · Voix · Gemini 2.0 Flash · Contrôle Home Assistant',
});
