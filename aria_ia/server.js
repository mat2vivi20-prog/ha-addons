const express          = require('express');
const http             = require('http');
const https            = require('https');
const { WebSocketServer, WebSocket } = require('ws');
const path             = require('path');
const fs               = require('fs');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const HA_URL       = 'http://supervisor/core';
const HA_WS_URL    = 'ws://supervisor/core/api/websocket';
const HA_TOKEN     = process.env.SUPERVISOR_TOKEN;
const PORT         = process.env.INGRESS_PORT || process.env.PORT || 3210;
const VIDEO_PATH   = process.env.VIDEO_PATH   || '/config/www/iamp4/ia.mp4';
const GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const USE_GEMINI   = !!GEMINI_KEY;

// ── DOMAINES ──────────────────────────────────────────────────────────────────
const CTRL_DOMAINS = [
  'light','switch','cover','climate','fan','media_player','scene','script',
  'automation','input_boolean','vacuum','alarm_control_panel','lock','siren',
  'number','select','input_number','input_select','input_text','input_datetime',
  'button','timer','counter',
];
const SENSOR_CLASSES_ALERT = ['smoke','co','gas','moisture','tamper','carbon_monoxide'];

// ── EXPRESS + HTTP ────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const clients = new Set();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/ia-face.mp4', (req, res) => {
  const src = [VIDEO_PATH, path.join(__dirname, 'public', 'ia-face.mp4')].find(p => fs.existsSync(p));
  src ? res.sendFile(src) : res.status(404).send('Vidéo introuvable');
});

// ── HA REST ───────────────────────────────────────────────────────────────────
function haReq(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(`${HA_URL}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${HA_TOKEN}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── HA WEBSOCKET INTERNE (événements temps réel) ──────────────────────────────
let haWs = null;
let haWsMsgId = 1;

function connectHAWS() {
  haWs = new WebSocket(HA_WS_URL);

  haWs.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.type === 'auth_required') {
      haWs.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
    } else if (msg.type === 'auth_ok') {
      haWs.send(JSON.stringify({ id: haWsMsgId++, type: 'subscribe_events', event_type: 'state_changed' }));
      console.log('[HA-WS] Connecté — abonné aux événements');
    } else if (msg.type === 'event') {
      handleStateChange(msg.event);
    }
  });

  haWs.on('close', () => {
    console.warn('[HA-WS] Déconnecté — reconnexion dans 5s');
    setTimeout(connectHAWS, 5000);
  });

  haWs.on('error', e => console.error('[HA-WS]', e.message));
}

function handleStateChange(event) {
  const { entity_id, new_state, old_state } = event?.data || {};
  if (!entity_id || !new_state || !old_state) return;
  if (new_state.state === old_state.state) return;

  // Alarme
  if (entity_id.startsWith('alarm_control_panel.')) {
    const labels = {
      disarmed:     '🔓 Alarme désarmée',
      armed_away:   '🔒 Alarme armée — mode Absent',
      armed_home:   '🏠 Alarme armée — mode Maison',
      armed_night:  '🌙 Alarme armée — mode Nuit',
      triggered:    '🚨 ALARME DÉCLENCHÉE !',
      pending:      '⏳ Alarme — vérification en cours',
      arming:       '🔄 Armement en cours…',
    };
    const name = new_state.attributes?.friendly_name || entity_id;
    const severity = new_state.state === 'triggered' ? 'critical' : 'info';
    broadcast({ type: 'proactive_alert', category: 'alarm', severity,
      text: `${labels[new_state.state] || `Alarme : ${new_state.state}`} — ${name}` });
  }

  // Présence
  if (entity_id.startsWith('person.')) {
    const name = new_state.attributes?.friendly_name || entity_id.replace('person.', '');
    const wasHome = old_state.state === 'home';
    const isHome  = new_state.state  === 'home';
    if (isHome  && !wasHome) broadcast({ type: 'proactive_alert', category: 'presence', severity: 'info', text: `🏠 ${name} est rentré(e) à la maison` });
    if (!isHome && wasHome)  broadcast({ type: 'proactive_alert', category: 'presence', severity: 'info', text: `🚶 ${name} a quitté la maison` });
  }

  // Capteurs critiques (fumée, CO, gaz, humidité)
  if (entity_id.startsWith('binary_sensor.')) {
    const dc = new_state.attributes?.device_class;
    if (SENSOR_CLASSES_ALERT.includes(dc) && new_state.state === 'on') {
      const icons = { smoke: '🔥', co: '☠️', carbon_monoxide: '☠️', gas: '⚠️', moisture: '💧', tamper: '🔓' };
      const name = new_state.attributes?.friendly_name || entity_id;
      broadcast({ type: 'proactive_alert', category: 'security', severity: 'critical',
        text: `${icons[dc] || '⚠️'} ALERTE SÉCURITÉ : ${name} !` });
    }
  }
}

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

// ── FETCH ENTITÉS ──────────────────────────────────────────────────────────────
async function fetchAllData() {
  try {
    const [statesRes, servicesRes] = await Promise.all([
      haReq('GET', '/api/states'),
      haReq('GET', '/api/services'),
    ]);
    const all      = statesRes.status === 200 ? JSON.parse(statesRes.body) : [];
    const services = servicesRes.status === 200 ? JSON.parse(servicesRes.body) : [];

    const notifySvc = services.find(s => s.domain === 'notify');
    const notifyTargets = notifySvc
      ? Object.keys(notifySvc.services || {})
          .filter(k => k.startsWith('mobile_app_') || k === 'notify')
          .map(k => `notify.${k}`)
      : [];

    return {
      controllable: all.filter(e => CTRL_DOMAINS.includes(e.entity_id.split('.')[0])),
      persons:      all.filter(e => ['person','device_tracker'].includes(e.entity_id.split('.')[0])),
      alarms:       all.filter(e => e.entity_id.startsWith('alarm_control_panel.')),
      calendars:    all.filter(e => e.entity_id.startsWith('calendar.')),
      sensors:      all.filter(e => e.entity_id.startsWith('sensor.')).slice(0, 40),
      activeSensors: all.filter(e =>
        e.entity_id.startsWith('binary_sensor.') && e.state === 'on' &&
        ['motion','door','window','smoke','co','gas','moisture','lock','vibration'].includes(e.attributes?.device_class)
      ),
      notifyTargets,
      totalEntities: all.length,
    };
  } catch (e) {
    console.error('[HA] fetchAllData:', e.message);
    return { controllable:[], persons:[], alarms:[], calendars:[], sensors:[], activeSensors:[], notifyTargets:[], totalEntities:0 };
  }
}

// ── SURVEILLANCE NOUVELLES INTÉGRATIONS ───────────────────────────────────────
let knownIntegrations = null;

async function checkIntegrations() {
  try {
    const res = await haReq('GET', '/api/config/config_entries/entry');
    if (res.status !== 200) return;
    const entries = JSON.parse(res.body);
    const current = new Map(entries.map(e => [e.entry_id, e]));
    if (knownIntegrations === null) { knownIntegrations = current; return; }
    for (const [id, entry] of current) {
      if (!knownIntegrations.has(id)) {
        console.log(`[ARIA] Nouvelle intégration : ${entry.title} (${entry.domain})`);
        broadcast({ type: 'proactive_alert', category: 'integration', severity: 'info',
          text: `🔌 Nouvelle intégration détectée : ${entry.title} (${entry.domain})` });
      }
    }
    knownIntegrations = current;
  } catch {}
}

// ── CONSTRUCTION DU PROMPT ────────────────────────────────────────────────────
const DOMAIN_LABELS = {
  light:'💡 LUMIÈRES', switch:'🔌 PRISES/INTER.', cover:'🪟 VOLETS',
  climate:'🌡️ CHAUFFAGE/CLIM', media_player:'🔊 MULTIMÉDIA', fan:'💨 VENTILATEURS',
  scene:'🎭 SCÈNES', script:'⚡ SCRIPTS', automation:'🤖 AUTOMATISATIONS',
  input_boolean:'🔘 BASCULES', vacuum:'🧹 ASPIRATEURS',
  alarm_control_panel:'🚨 ALARME', lock:'🔑 SERRURES', siren:'📢 SIRÈNES',
  number:'🔢 NOMBRES', select:'📋 SÉLECTEURS', input_number:'🔢 ENTRÉES NUM.',
  input_select:'📋 ENTRÉES SÉLECT.', input_text:'📝 ENTRÉES TEXTE',
  input_datetime:'📅 DATES/HEURES', button:'🔲 BOUTONS',
  timer:'⏱️ MINUTEURS', counter:'🔢 COMPTEURS',
};

function fmt(e) {
  const name = e.attributes?.friendly_name || e.entity_id;
  return `  • ${name} [${e.entity_id}] → ${e.state}`;
}

function buildPrompt(data) {
  const { controllable, persons, alarms, calendars, activeSensors, notifyTargets, totalEntities } = data;
  const now = new Date();
  const parisDate = now.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  // Présence
  let presenceSection = '';
  if (persons.length) {
    presenceSection = '\n═══ PRÉSENCE & GÉOLOCALISATION ═══\n';
    presenceSection += persons.map(p => {
      const name = p.attributes?.friendly_name || p.entity_id;
      const icon = p.state === 'home' ? '🏠' : '🚶';
      return `  • ${icon} ${name} [${p.entity_id}] → ${p.state === 'home' ? 'À la maison' : p.state}`;
    }).join('\n');
  }

  // Alarme
  let alarmSection = '';
  if (alarms.length) {
    alarmSection = '\n\n═══ ALARME ═══\n';
    const alarmLabels = { disarmed:'Désarmée 🔓', armed_away:'Armée — Absent 🔒',
      armed_home:'Armée — Maison 🏠', armed_night:'Armée — Nuit 🌙', triggered:'⚠️ DÉCLENCHÉE', arming:'En armement…' };
    alarmSection += alarms.map(a => `  • ${a.attributes?.friendly_name || a.entity_id} → ${alarmLabels[a.state] || a.state}`).join('\n');
  }

  // Capteurs actifs
  let sensorSection = '';
  if (activeSensors.length) {
    sensorSection = '\n\n═══ ALERTES CAPTEURS ACTIVES ═══\n';
    sensorSection += activeSensors.map(s =>
      `  • ⚠️ ${s.attributes?.friendly_name || s.entity_id} (${s.attributes?.device_class}) → ON`
    ).join('\n');
  }

  // Calendriers
  let calSection = '';
  if (calendars.length) {
    calSection = '\n\n═══ CALENDRIERS DISPONIBLES ═══\n';
    calSection += calendars.map(c => `  • ${c.attributes?.friendly_name || c.entity_id} [${c.entity_id}]`).join('\n');
  }

  // Notifications mobiles disponibles
  let notifySection = '';
  if (notifyTargets.length) {
    notifySection = '\n\n═══ NOTIFICATIONS MOBILES ═══\n';
    notifySection += notifyTargets.map(n => `  • [${n}]`).join('\n');
  }

  // Appareils contrôlables groupés
  const grouped = {};
  for (const e of controllable) {
    const d = e.entity_id.split('.')[0];
    (grouped[d] = grouped[d] || []).push(fmt(e));
  }
  let devices = '';
  for (const [d, items] of Object.entries(grouped)) {
    devices += `\n${DOMAIN_LABELS[d] || d.toUpperCase()} :\n${items.join('\n')}\n`;
  }

  return `Tu es ARIA, l'assistante IA superintelligente de la maison de Vitrolles.
Tu réponds TOUJOURS en français, de façon naturelle et chaleureuse, en 2-3 phrases maximum.
Pas de markdown, pas d'astérisques — tes réponses sont lues à voix haute.
Tu es proactive : tu surveilles l'alarme, la présence, les capteurs et les nouvelles intégrations.
Tu peux programmer sur des semaines, des mois, créer des rappels, contrôler tous les équipements.

═══ DATE & HEURE ═══
${parisDate}
${presenceSection}${alarmSection}${sensorSection}${calSection}${notifySection}

═══ APPAREILS DISPONIBLES (${totalEntities} entités totales) ═══
${devices || 'Aucun appareil détecté.'}

═══ TOUTES LES COMMANDES DISPONIBLES ═══

— Lumières :
<<HA:light.turn_on:{"entity_id":"light.xxx"}>>
<<HA:light.turn_off:{"entity_id":"light.xxx"}>>
<<HA:light.turn_on:{"entity_id":"light.xxx","brightness":200,"color_temp":370,"rgb_color":[255,100,0]}>>

— Prises / interrupteurs / bascules :
<<HA:switch.turn_on:{"entity_id":"switch.xxx"}>>
<<HA:input_boolean.turn_on:{"entity_id":"input_boolean.xxx"}>>
<<HA:button.press:{"entity_id":"button.xxx"}>>

— Volets / stores :
<<HA:cover.open_cover:{"entity_id":"cover.xxx"}>>
<<HA:cover.close_cover:{"entity_id":"cover.xxx"}>>
<<HA:cover.set_cover_position:{"entity_id":"cover.xxx","position":50}>>

— Chauffage / clim :
<<HA:climate.set_temperature:{"entity_id":"climate.xxx","temperature":21}>>
<<HA:climate.set_hvac_mode:{"entity_id":"climate.xxx","hvac_mode":"heat"}>>

— Alarme (utilise le code si nécessaire) :
<<HA:alarm_control_panel.arm_away:{"entity_id":"alarm_control_panel.xxx","code":"0000"}>>
<<HA:alarm_control_panel.arm_home:{"entity_id":"alarm_control_panel.xxx","code":"0000"}>>
<<HA:alarm_control_panel.arm_night:{"entity_id":"alarm_control_panel.xxx","code":"0000"}>>
<<HA:alarm_control_panel.disarm:{"entity_id":"alarm_control_panel.xxx","code":"0000"}>>

— Serrures :
<<HA:lock.lock:{"entity_id":"lock.xxx"}>>
<<HA:lock.unlock:{"entity_id":"lock.xxx"}>>

— Paramètres réglables :
<<HA:input_number.set_value:{"entity_id":"input_number.xxx","value":21}>>
<<HA:input_select.select_option:{"entity_id":"input_select.xxx","option":"Option"}>>
<<HA:input_text.set_value:{"entity_id":"input_text.xxx","value":"Texte"}>>
<<HA:number.set_value:{"entity_id":"number.xxx","value":75}>>
<<HA:select.select_option:{"entity_id":"select.xxx","option":"Option"}>>
<<HA:timer.start:{"entity_id":"timer.xxx","duration":"00:30:00"}>>
<<HA:timer.cancel:{"entity_id":"timer.xxx"}>>

— Multimédia :
<<HA:media_player.volume_set:{"entity_id":"media_player.xxx","volume_level":0.5}>>
<<HA:media_player.media_play_pause:{"entity_id":"media_player.xxx"}>>

— Notifications mobiles :
<<HA:notify.mobile_app_xxx:{"title":"Titre","message":"Message"}>>
<<HA:persistent_notification.create:{"title":"Titre","message":"Message","notification_id":"aria_xxx"}>>

— Calendrier & rappels :
<<HA:calendar.create_event:{"entity_id":"calendar.xxx","summary":"Titre","start_date_time":"2026-06-01T09:00:00","end_date_time":"2026-06-01T10:00:00","description":"Détails"}>>

— Scènes / scripts :
<<HA:scene.turn_on:{"entity_id":"scene.xxx"}>>
<<HA:script.turn_on:{"entity_id":"script.xxx"}>>

— Créer une automatisation (tout type de planning) :

  // Une seule fois :
  <<HA:automation.create:{"alias":"Rappel demain matin","trigger":[{"platform":"time","at":"08:00:00"}],"condition":[{"condition":"template","value_template":"{{ now().date() == (now() + timedelta(days=0)).date() }}"}],"action":[{"service":"notify.mobile_app_iphone","data":{"title":"Rappel","message":"N'oublie pas !"}}]}>>

  // Chaque jour :
  <<HA:automation.create:{"alias":"Volets le matin","trigger":[{"platform":"time","at":"08:00:00"}],"action":[{"service":"cover.open_cover","target":{"entity_id":"cover.salon"}}]}>>

  // Lundi au vendredi seulement :
  <<HA:automation.create:{"alias":"Réveil semaine","trigger":[{"platform":"time","at":"07:00:00"}],"condition":[{"condition":"time","weekday":["mon","tue","wed","thu","fri"]}],"action":[{"service":"light.turn_on","target":{"entity_id":"light.chambre"}}]}>>

  // Week-end uniquement :
  <<HA:automation.create:{"alias":"Réveil week-end","trigger":[{"platform":"time","at":"09:00:00"}],"condition":[{"condition":"time","weekday":["sat","sun"]}],"action":[{"service":"light.turn_on","target":{"entity_id":"light.chambre"}}]}>>

  // Le 1er de chaque mois :
  <<HA:automation.create:{"alias":"Rappel mensuel loyer","trigger":[{"platform":"template","value_template":"{{ now().day == 1 and now().hour == 9 and now().minute == 0 }}"}],"action":[{"service":"notify.mobile_app_iphone","data":{"title":"Rappel mensuel","message":"Penser au loyer"}}]}>>

  // Quand quelqu'un rentre :
  <<HA:automation.create:{"alias":"Bienvenue à la maison","trigger":[{"platform":"state","entity_id":"person.xxx","to":"home"}],"action":[{"service":"light.turn_on","target":{"entity_id":"light.entree"}}]}>>

  // Quand tout le monde est parti :
  <<HA:automation.create:{"alias":"Mode absent automatique","trigger":[{"platform":"state","entity_id":"person.xxx","to":"not_home"}],"condition":[{"condition":"template","value_template":"{{ states('person.yyy') != 'home' }}"}],"action":[{"service":"alarm_control_panel.arm_away","target":{"entity_id":"alarm_control_panel.maison"},"data":{"code":"0000"}}]}>>

  // Sur déclenchement d'alarme :
  <<HA:automation.create:{"alias":"Notification alarme","trigger":[{"platform":"state","entity_id":"alarm_control_panel.maison","to":"triggered"}],"action":[{"service":"notify.mobile_app_iphone","data":{"title":"🚨 ALARME","message":"L'alarme de la maison a été déclenchée !"}}]}>>

═══ RÈGLES ABSOLUES ═══
• Utilise les entity_id EXACTS de la liste (entre crochets)
• Confirme toujours avec une phrase naturelle : "C'est fait !", "Voilà !", etc.
• Si l'appareil n'existe pas, dis-le poliment sans inventer d'entity_id
• Pour les automatisations, explique ce que tu viens de programmer
• Pour l'alarme, demande toujours confirmation avant de désarmer
• Tu peux combiner plusieurs commandes en une seule réponse`;
}

// ── GEMINI STREAMING ──────────────────────────────────────────────────────────
function streamGemini(systemPrompt, history, onChunk) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: history,
      generationConfig: { maxOutputTokens: 600, temperature: 0.75 },
    });
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      if (res.statusCode !== 200) {
        const parts = [];
        res.on('data', c => parts.push(c));
        res.on('end', () => reject(new Error(`Gemini HTTP ${res.statusCode}: ${Buffer.concat(parts)}`)));
        return;
      }
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const d = JSON.parse(raw);
            const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) onChunk(text);
            if (d.candidates?.[0]?.finishReason) resolve();
          } catch {}
        }
      });
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── OLLAMA STREAMING ──────────────────────────────────────────────────────────
function streamOllama(systemPrompt, messages, onChunk) {
  return new Promise((resolve, reject) => {
    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.parts[0].text })),
    ];
    const body = JSON.stringify({ model: OLLAMA_MODEL, messages: ollamaMessages, stream: true });
    const req = http.request(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, res => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try { const d = JSON.parse(line); if (d.message?.content) onChunk(d.message.content); if (d.done) resolve(); } catch {}
        }
      });
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── PARSE & EXÉCUTER COMMANDES HA ─────────────────────────────────────────────
async function execHACmd(domain, service, data) {
  try {
    if (domain === 'automation' && service === 'create') {
      const id = (data.alias || `aria_${Date.now()}`).toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const payload = { ...data }; delete payload.id;
      const r = await haReq('POST', `/api/config/automation/config/${id}`, payload);
      return { ok: r.status >= 200 && r.status < 300, status: r.status };
    }
    if (domain === 'persistent_notification') {
      const r = await haReq('POST', `/api/services/persistent_notification/${service}`, data || {});
      return { ok: r.status >= 200 && r.status < 300, status: r.status };
    }
    const r = await haReq('POST', `/api/services/${domain}/${service}`, data || {});
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function parseAndExec(text) {
  const re = /<<HA:([\w.]+):([\s\S]*?)>>/g;
  const done = []; let m;
  while ((m = re.exec(text)) !== null) {
    const [, svc, dataStr] = m;
    const dot = svc.lastIndexOf('.');
    const domain = svc.slice(0, dot); const action = svc.slice(dot + 1);
    try {
      const data = dataStr.trim() === 'null' ? {} : JSON.parse(dataStr.trim());
      console.log(`[HA] → ${domain}.${action}`, data);
      const result = await execHACmd(domain, action, data);
      done.push({ cmd: `${domain}.${action}`, ...result });
      console.log(`[HA] ${result.ok ? '✓' : '✗'} ${domain}.${action}`);
    } catch (e) {
      done.push({ cmd: svc, ok: false, error: e.message });
    }
  }
  return done;
}

// ── WEBSOCKET CLIENTS ─────────────────────────────────────────────────────────
wss.on('connection', async ws => {
  clients.add(ws);
  console.log(`[ARIA] Client connecté (${clients.size} total)`);
  console.log(`[ARIA] Backend : ${USE_GEMINI ? 'Gemini 2.0 Flash' : `Ollama (${OLLAMA_MODEL})`}`);

  let data         = await fetchAllData();
  let systemPrompt = buildPrompt(data);
  let history      = [];

  console.log(`[HA] ${data.totalEntities} entités · ${data.persons.length} personnes · ${data.alarms.length} alarmes`);

  ws.send(JSON.stringify({
    type: 'ready',
    text: 'Bonjour ! Je suis ARIA, votre assistante intelligente. Je surveille votre maison en temps réel. Comment puis-je vous aider ?',
    entityCount: data.totalEntities,
    personsHome: data.persons.filter(p => p.state === 'home').map(p => p.attributes?.friendly_name || p.entity_id),
    alarmState: data.alarms[0]?.state || null,
  }));

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'reset') {
      data         = await fetchAllData();
      systemPrompt = buildPrompt(data);
      history      = [];
      ws.send(JSON.stringify({ type: 'ready', text: 'Conversation réinitialisée. Données maison actualisées, je suis prête !', entityCount: data.totalEntities }));
      return;
    }

    if (msg.type === 'refresh') {
      data         = await fetchAllData();
      systemPrompt = buildPrompt(data);
      ws.send(JSON.stringify({ type: 'refreshed', entityCount: data.totalEntities }));
      return;
    }

    if (msg.type !== 'speak' || !msg.text?.trim()) return;

    console.log('[User]', msg.text);
    ws.send(JSON.stringify({ type: 'thinking' }));
    history.push({ role: 'user', parts: [{ text: msg.text }] });

    let fullResponse = '';
    ws.send(JSON.stringify({ type: 'speaking_start' }));

    try {
      if (USE_GEMINI) {
        await streamGemini(systemPrompt, history, chunk => {
          fullResponse += chunk;
          ws.send(JSON.stringify({ type: 'chunk', text: chunk }));
        });
      } else {
        await streamOllama(systemPrompt, history, chunk => {
          fullResponse += chunk;
          ws.send(JSON.stringify({ type: 'chunk', text: chunk }));
        });
      }

      const actions   = await parseAndExec(fullResponse);
      const cleanText = fullResponse.replace(/<<HA:[\s\S]*?>>/g, '').replace(/\s+/g, ' ').trim();

      history.push({ role: 'model', parts: [{ text: cleanText }] });
      if (history.length > 24) history = history.slice(-24);

      ws.send(JSON.stringify({
        type: 'response', text: cleanText,
        actions: actions.filter(a => a.ok).map(a => a.cmd),
        failed: actions.filter(a => !a.ok).map(a => a.cmd),
      }));

    } catch (err) {
      console.error('[IA] Error:', err.message);
      history.pop();
      const errText = USE_GEMINI
        ? "Désolée, je n'arrive pas à joindre Gemini. Vérifiez la clé API."
        : "Désolée, je n'arrive pas à joindre Ollama. Vérifiez qu'il est démarré.";
      ws.send(JSON.stringify({ type: 'error', text: errText }));
    }
  });

  ws.on('close', () => { clients.delete(ws); console.log(`[ARIA] Client déconnecté (${clients.size} restant)`); });
  ws.on('error', e => console.error('[ARIA] WS error:', e.message));
});

// ── DÉMARRAGE ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[ARIA] ✓ Démarrée sur le port ${PORT}`);
  console.log(`[ARIA]   Backend   : ${USE_GEMINI ? 'Gemini 2.0 Flash' : `Ollama (${OLLAMA_MODEL} @ ${OLLAMA_URL})`}`);
  console.log(`[ARIA]   Vidéo     : ${VIDEO_PATH}`);
  // Connexion WebSocket HA pour les événements temps réel
  connectHAWS();
  // Surveillance des nouvelles intégrations toutes les 5 minutes
  setTimeout(checkIntegrations, 3000);
  setInterval(checkIntegrations, 5 * 60 * 1000);
});
