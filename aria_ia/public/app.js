// ── WebSocket ─────────────────────────────────────────────────────────────────
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsBase   = location.pathname.replace(/\/$/, '');
const ws       = new WebSocket(`${protocol}//${location.host}${wsBase}`);

// ── DOM ───────────────────────────────────────────────────────────────────────
const video       = document.getElementById('ia-face');
const ring        = document.getElementById('ring');
const statusEl    = document.getElementById('status');
const userBubble  = document.getElementById('user-bubble');
const ariaBubble  = document.getElementById('aria-bubble');
const haActions   = document.getElementById('ha-actions');
const micBtn      = document.getElementById('mic-btn');
const transcript  = document.getElementById('transcript');
const autoBtn     = document.getElementById('auto-btn');
const alertBanner = document.getElementById('alert-banner');
const alarmBadge  = document.getElementById('alarm-badge');

// ── État ──────────────────────────────────────────────────────────────────────
let recognition    = null;
let isListening    = false;
let isSpeaking     = false;
let autoListen     = false;
let frVoice        = null;
let ariaBuffer     = '';
let haActionsTimer = null;
let alertQueue     = [];
let alertTimer     = null;

// ── WebSocket ─────────────────────────────────────────────────────────────────
ws.onopen = () => {
  setMode('idle');
  setStatus('Connexion établie…', '');
  loadVoice();
};

ws.onmessage = e => {
  const msg = JSON.parse(e.data);

  switch (msg.type) {
    case 'ready':
      ariaBuffer = msg.text;
      showBubble('aria', msg.text);
      updateAlarmBadge(msg.alarmState);
      if (msg.personsHome?.length) {
        setStatus(`Prête · ${msg.personsHome.join(', ')} à la maison`, '');
      } else {
        setStatus(`Prête${msg.entityCount ? ` · ${msg.entityCount} appareils` : ''}`, '');
      }
      speak(msg.text);
      break;

    case 'refreshed':
      setStatus(`Données actualisées · ${msg.entityCount} appareils`, '');
      break;

    case 'thinking':
      setMode('thinking');
      setStatus('Réflexion…', 'thinking');
      ariaBubble.textContent = '…';
      ariaBubble.classList.remove('hidden');
      ariaBuffer = '';
      break;

    case 'speaking_start':
      ariaBuffer = '';
      ariaBubble.classList.remove('hidden');
      ariaBubble.textContent = '';
      break;

    case 'chunk':
      ariaBuffer += msg.text;
      ariaBubble.textContent = ariaBuffer.replace(/<<HA:[\s\S]*?>>/g, '').trim();
      break;

    case 'response':
      showBubble('aria', msg.text);
      showActions(msg.actions, msg.failed);
      speak(msg.text);
      break;

    case 'error':
      showBubble('aria', msg.text);
      setMode('idle');
      setStatus('Erreur', 'error');
      speak(msg.text);
      break;

    case 'proactive_alert':
      handleProactiveAlert(msg);
      break;
  }
};

ws.onclose = () => {
  setMode('idle');
  setStatus('Déconnecté — rechargez la page', 'error');
};

// ── ALERTES PROACTIVES ────────────────────────────────────────────────────────
function handleProactiveAlert(msg) {
  const { category, severity, text } = msg;

  // Mise à jour badge alarme
  if (category === 'alarm') {
    const stateFromText = text.includes('Désarmée') ? 'disarmed'
      : text.includes('Absent') ? 'armed_away'
      : text.includes('Maison') ? 'armed_home'
      : text.includes('DÉCL') ? 'triggered'
      : null;
    if (stateFromText) updateAlarmBadge(stateFromText);
  }

  // Affiche la bannière
  showAlert(text, severity);

  // Lecture vocale pour les alertes critiques
  if (severity === 'critical') {
    speechSynthesis.cancel();
    speak(text);
  }

  // Notification navigateur
  if (Notification.permission === 'granted') {
    new Notification('ARIA — Maison', { body: text, icon: '/icon.png' });
  }
}

function showAlert(text, severity = 'info') {
  alertQueue.push({ text, severity });
  if (!alertTimer) displayNextAlert();
}

function displayNextAlert() {
  if (!alertQueue.length) { alertTimer = null; return; }
  const { text, severity } = alertQueue.shift();
  alertBanner.textContent  = text;
  alertBanner.className    = `alert-banner ${severity}`;
  alertBanner.classList.remove('hidden');
  alertTimer = setTimeout(() => {
    alertBanner.classList.add('hidden');
    alertTimer = setTimeout(displayNextAlert, 400);
  }, severity === 'critical' ? 8000 : 5000);
}

function updateAlarmBadge(state) {
  if (!state || !alarmBadge) return;
  const icons   = { disarmed: '🔓', armed_away: '🔒', armed_home: '🏠', armed_night: '🌙', triggered: '🚨', arming: '🔄', pending: '⏳' };
  const classes = { disarmed: 'disarmed', armed_away: 'armed', armed_home: 'armed-home', triggered: 'triggered' };
  alarmBadge.textContent = icons[state] || '❓';
  alarmBadge.className   = `alarm-badge ${classes[state] || ''}`;
  alarmBadge.title       = `Alarme : ${state}`;
}

// ── Voix française ────────────────────────────────────────────────────────────
function loadVoice() {
  function pick() {
    const voices = speechSynthesis.getVoices();
    frVoice =
      voices.find(v => v.lang.startsWith('fr') && /hortense|amelie|virginie|julie|marie|female|féminin/i.test(v.name)) ||
      voices.find(v => v.lang === 'fr-FR' && !/male|masculin/i.test(v.name)) ||
      voices.find(v => v.lang.startsWith('fr-')) ||
      voices.find(v => v.lang.startsWith('fr'));
    if (frVoice) console.log('🔊 Voix:', frVoice.name, frVoice.lang);
  }
  pick();
  speechSynthesis.onvoiceschanged = pick;

  // Demande permission notifications navigateur
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ── TTS ───────────────────────────────────────────────────────────────────────
function speak(text) {
  const clean = text.replace(/<<HA:[\s\S]*?>>/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) { onSpeakEnd(); return; }
  speechSynthesis.cancel();
  const u  = new SpeechSynthesisUtterance(clean);
  u.lang   = 'fr-FR';
  u.rate   = 1.0;
  u.pitch  = 1.1;
  if (frVoice) u.voice = frVoice;
  u.onstart = () => { setMode('speaking'); setStatus('Répond…', 'speaking'); video.play().catch(() => {}); };
  u.onend   = () => { video.pause(); video.currentTime = 0; onSpeakEnd(); };
  u.onerror = () => { video.pause(); onSpeakEnd(); };
  speechSynthesis.speak(u);
}

function onSpeakEnd() {
  if (autoListen) {
    setTimeout(() => { if (!isListening) startListening(); }, 600);
  } else {
    setMode('idle');
    setStatus('Prête', '');
  }
}

// ── STT ───────────────────────────────────────────────────────────────────────
function buildRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Reconnaissance vocale non supportée.\nUtilisez Google Chrome ou Microsoft Edge.');
    return null;
  }
  const r = new SR();
  r.lang            = 'fr-FR';
  r.continuous      = false;
  r.interimResults  = true;
  r.maxAlternatives = 1;

  r.onresult = e => {
    const t = Array.from(e.results).map(x => x[0].transcript).join('');
    transcript.textContent = t;
    if (e.results[e.results.length - 1].isFinal && t.trim()) {
      transcript.textContent = '';
      showBubble('user', t.trim());
      ws.send(JSON.stringify({ type: 'speak', text: t.trim() }));
      stopListening();
    }
  };

  r.onspeechend = () => r.stop();
  r.onerror = err => {
    if (err.error !== 'no-speech') console.warn('STT:', err.error);
    stopListening();
    transcript.textContent = '';
  };
  r.onend = () => { if (isListening) try { r.start(); } catch (_) {} };
  return r;
}

function startListening() {
  if (!recognition) recognition = buildRecognition();
  if (!recognition) return;
  isListening = true;
  try { recognition.start(); } catch (_) {}
  setMode('listening');
  setStatus('Écoute…', 'active');
}

function stopListening() {
  isListening = false;
  if (recognition) try { recognition.stop(); } catch (_) {}
  if (!isSpeaking) { setMode('idle'); setStatus('Prête', ''); }
  transcript.textContent = '';
}

// ── Bouton micro ──────────────────────────────────────────────────────────────
function toggleMic() {
  if (isSpeaking) {
    speechSynthesis.cancel();
    video.pause();
    setMode('idle');
    setStatus('Prête', '');
    return;
  }
  if (isListening) stopListening();
  else startListening();
}

// ── Auto-écoute ───────────────────────────────────────────────────────────────
function toggleAuto() {
  autoListen = !autoListen;
  autoBtn.classList.toggle('active', autoListen);
  autoBtn.title = autoListen ? 'Auto-écoute activée (cliquer pour désactiver)' : "Activer l'auto-écoute";
  setStatus(autoListen ? 'Auto-écoute active' : 'Prête', autoListen ? 'auto' : '');
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetConv() {
  speechSynthesis.cancel();
  stopListening();
  ws.send(JSON.stringify({ type: 'reset' }));
  ariaBuffer = '';
  userBubble.classList.add('hidden');
  ariaBubble.classList.add('hidden');
  haActions.textContent = '';
  setMode('idle');
  setStatus('Réinitialisation…', '');
}

// ── Actualiser les données ────────────────────────────────────────────────────
function refreshData() {
  ws.send(JSON.stringify({ type: 'refresh' }));
  setStatus('Actualisation…', 'thinking');
}

// ── Helpers UI ────────────────────────────────────────────────────────────────
function setMode(mode) {
  ring.className   = 'ring ' + mode;
  micBtn.className = mode !== 'idle' ? mode : '';
  isSpeaking       = mode === 'speaking';
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className   = cls || '';
}

function showBubble(who, text) {
  const el = who === 'user' ? userBubble : ariaBubble;
  el.textContent = text;
  el.classList.remove('hidden');
}

function showActions(actions, failed) {
  clearTimeout(haActionsTimer);
  let parts = [];
  if (actions?.length)  parts.push('✓ ' + actions.join('  ·  '));
  if (failed?.length)   parts.push('✗ ' + failed.join('  ·  '));
  if (!parts.length) return;
  haActions.innerHTML = parts.map((p, i) => `<span class="${i === 1 ? 'failed' : ''}">${p}</span>`).join(' ');
  haActionsTimer = setTimeout(() => { haActions.innerHTML = ''; }, 7000);
}

// ── Champ texte ───────────────────────────────────────────────────────────────
const textInput = document.getElementById('text-input');

function sendText() {
  const val = textInput.value.trim();
  if (!val) return;
  textInput.value = '';
  showBubble('user', val);
  ws.send(JSON.stringify({ type: 'speak', text: val }));
  stopListening();
}

textInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } };

// ── Raccourcis clavier ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space')  { e.preventDefault(); toggleMic(); }
  if (e.code === 'KeyR')   { e.preventDefault(); resetConv(); }
  if (e.code === 'KeyA')   { e.preventDefault(); toggleAuto(); }
  if (e.code === 'KeyF')   { e.preventDefault(); refreshData(); }
});
