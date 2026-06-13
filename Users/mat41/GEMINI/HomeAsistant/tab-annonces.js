// ══════════════════════════════════════════════════════════════════════════════
// ARIA ANNONCES v1 — Gestion complète des annonces vocales automatiques
// ══════════════════════════════════════════════════════════════════════════════

const _ANN_CATS = [
  {
    id: 'portes',
    entity: 'input_boolean.aria_annonce_portes',
    icon: 'ti-door',
    label: 'PORTES & FENÊTRES',
    color: '#ff9900',
    desc: 'Ouverture détectée (entrée, garage, piscine, véranda)',
    test: "La porte d'entrée vient de s'ouvrir.",
    sensors: [
      {eid:'binary_sensor.porte_d_entree_salon',      name:'Entrée salon'},
      {eid:'binary_sensor.capteur_de_garage',          name:'Garage'},
      {eid:'binary_sensor.capteur_de_contact_piscine', name:'Portail piscine'},
      {eid:'binary_sensor.capteur_d_ouverture_veranda',name:'Véranda'},
    ],
  },
  {
    id: 'lumieres',
    entity: 'input_boolean.aria_annonce_lumieres',
    icon: 'ti-bulb',
    label: 'LUMIÈRES',
    color: '#ffd700',
    desc: 'Allumage et extinction des principales pièces',
    test: "La lumière du salon vient de s'allumer.",
    sensors: [
      {eid:'light.salon',              name:'Salon'},
      {eid:'light.lumere_cuisine',      name:'Cuisine'},
      {eid:'light.chambre_de_baptiste', name:'Baptiste'},
      {eid:'light.chambre_shani',       name:'Shani'},
      {eid:'light.lumiere_veranda',     name:'Véranda'},
    ],
  },
  {
    id: 'clim',
    entity: 'input_boolean.aria_annonce_clim',
    icon: 'ti-wind',
    label: 'CLIMATISEURS',
    color: '#00c8ff',
    desc: 'Mise en route et arrêt des climatiseurs',
    test: 'Le climatiseur du salon est en route.',
    sensors: [
      {eid:'climate.climatiseur_salon',             name:'Salon'},
      {eid:'climate.climatiseur_chambre_parentale', name:'Chambre parentale'},
      {eid:'climate.clim_baptiste',                 name:'Baptiste'},
      {eid:'climate.clim_shani',                    name:'Shani'},
    ],
  },
  {
    id: 'piscine',
    entity: 'input_boolean.aria_annonce_piscine',
    icon: 'ti-pool',
    label: 'PISCINE',
    color: '#00bfff',
    desc: 'Pompe, lumière et sécurité piscine',
    test: 'Le moteur de la piscine est en route.',
    sensors: [
      {eid:'switch.moteur_piscine', name:'Pompe'},
      {eid:'switch.lumiere_piscine',name:'Lumière'},
    ],
  },
  {
    id: 'presence',
    entity: 'input_boolean.aria_annonce_presence',
    icon: 'ti-user-check',
    label: 'PRÉSENCE',
    color: '#bb88ff',
    desc: 'Arrivées et départs des membres de la famille',
    test: "Quelqu'un vient d'arriver à la maison.",
    sensors: [
      {eid:'person.mat2viv',  name:'Matthias'},
      {eid:'person.vichara',  name:'Vichara'},
    ],
  },
  {
    id: 'cameras',
    entity: 'input_boolean.aria_annonce_cameras',
    icon: 'ti-camera',
    label: 'CAMÉRAS',
    color: '#ff4455',
    desc: 'Mouvement détecté par les caméras extérieures',
    test: "Mouvement détecté à l'entrée de la maison.",
  },
  {
    id: 'interphone',
    entity: 'input_boolean.aria_annonce_interphone',
    icon: 'ti-bell-ringing',
    label: 'INTERPHONE / SONNETTE',
    color: '#fd79a8',
    desc: 'Visiteur à la porte — interphone activé',
    test: 'Quelqu\'un sonne à la porte.',
    sensors: [
      {eid:'input_boolean.aria_interphone_enabled', name:'Interphone actif'},
    ],
  },
  {
    id: 'agenda',
    entity: 'input_boolean.aria_annonce_agenda',
    icon: 'ti-calendar-event',
    label: 'AGENDA & ANNIVERSAIRES',
    color: '#4ecdc4',
    desc: 'Rappels d\'événements et anniversaires',
    test: 'Rappel : réunion dans trente minutes.',
  },
  {
    id: 'meteo',
    entity: 'input_boolean.aria_annonce_meteo',
    icon: 'ti-cloud-storm',
    label: 'MÉTÉO',
    color: '#74b9ff',
    desc: 'Alertes météo et prévisions importantes',
    test: "Alerte météo : risque d'orage cette après-midi.",
  },
  {
    id: 'energie',
    entity: 'input_boolean.aria_annonce_energie',
    icon: 'ti-bolt',
    label: 'ÉNERGIE',
    color: '#fdcb6e',
    desc: 'Pics de consommation et anomalies électriques',
    test: 'Pic de consommation électrique détecté.',
  },
  {
    id: 'routines',
    entity: 'input_boolean.aria_routines_actif',
    icon: 'ti-robot',
    label: 'ROUTINES ARIA',
    color: '#00e5a0',
    desc: 'Annonces automatiques matin/soir activées',
    test: 'Bonjour ! Bonne journée à toute la famille.',
  },
];

// ── Envoyer un message vocal ARIA ─────────────────────────────────────────────
async function _annSpeak(msg) {
  try {
    await fetch(HA_URL + '/api/services/notify/mobile_app_kt1028', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + HA_TOKEN, 'Content-Type': 'application/json'},
      body: JSON.stringify({message: 'command_screen_on'}),
    });
    await new Promise(r => setTimeout(r, 400));
    const r = await fetch(HA_URL + '/api/services/input_text/set_value', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + HA_TOKEN, 'Content-Type': 'application/json'},
      body: JSON.stringify({entity_id: 'input_text.aria_message', value: msg}),
    });
    if (r.ok) {
      showToast('🔊 ARIA : ' + msg.substring(0, 40));
      setTimeout(() => {
        fetch(HA_URL + '/api/services/input_text/set_value', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + HA_TOKEN, 'Content-Type': 'application/json'},
          body: JSON.stringify({entity_id: 'input_text.aria_message', value: ''}),
        }).catch(() => {});
      }, 16000);
    }
  } catch (e) { showToast('Erreur réseau'); }
}

// ── Toggle input_boolean ──────────────────────────────────────────────────────
function _annToggle(entityId, cardEl) {
  const cur = haState(entityId);
  const next = cur === 'on' ? 'off' : 'on';
  if (!S._stMap[entityId]) S._stMap[entityId] = {entity_id: entityId, state: 'off', attributes: {}};
  S._stMap[entityId] = Object.assign({}, S._stMap[entityId], {state: next});
  haCall('input_boolean', next === 'on' ? 'turn_on' : 'turn_off', {entity_id: entityId});
  // update toggle display immediately
  const tgl = cardEl ? cardEl.querySelector('.ann-tgl') : null;
  if (tgl) {
    tgl.classList.toggle('ann-tgl-on', next === 'on');
    tgl.querySelector('.ann-tgl-knob').style.transform = next === 'on' ? 'translateX(20px)' : 'translateX(0)';
  }
  const badge = cardEl ? cardEl.querySelector('.ann-badge') : null;
  if (badge) { badge.textContent = next === 'on' ? 'ACTIF' : 'OFF'; badge.style.color = next === 'on' ? '#00e5a0' : '#888'; }
  haScheduleRefresh(1500);
}

// ── Couleur d'état capteur ────────────────────────────────────────────────────
function _annSensorColor(eid) {
  const st = haState(eid);
  if (!st || st === 'unavailable' || st === 'unknown') return '#555';
  if (st === 'on' || st === 'open' || st === 'home') return '#00e5a0';
  if (st === 'off' || st === 'closed') return '#444';
  if (st === 'cool' || st === 'heat' || st === 'heat_cool') return '#00c8ff';
  return '#888';
}

function _annSensorLabel(eid) {
  const st = haState(eid);
  if (!st || st === 'unavailable') return 'N/A';
  if (eid.startsWith('binary_sensor.')) return st === 'on' ? 'Ouvert' : 'Fermé';
  if (eid.startsWith('light.'))        return st === 'on' ? 'Allumée' : 'Éteinte';
  if (eid.startsWith('switch.'))       return st === 'on' ? 'En route' : 'Arrêté';
  if (eid.startsWith('climate.'))      return st === 'off' ? 'Arrêté' : st;
  if (eid.startsWith('person.'))       return st === 'home' ? 'Maison' : 'Absent';
  if (eid.startsWith('input_boolean.'))return st === 'on' ? 'Actif' : 'Inactif';
  return st;
}

// ── Rendu principal ───────────────────────────────────────────────────────────
window.renderTab_annonces = function(container) {

  const globalOn = _ANN_CATS.some(c => haState(c.entity) === 'on');

  let html = `<div style="padding:10px 6px;display:flex;flex-direction:column;gap:10px">

    <!-- ARIA PARLE rapide -->
    <div style="background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.25);border-radius:14px;padding:14px 14px 12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <i class="ti ti-microphone" style="font-size:20px;color:#00e5a0"></i>
        <span style="font-size:13px;font-weight:700;color:#00e5a0;letter-spacing:1px">ARIA PARLE</span>
        <span style="margin-left:auto;font-size:10px;color:var(--txt3)">Envoi direct</span>
      </div>
      <div style="display:flex;gap:8px">
        <input id="ann-quick-input" type="text" placeholder="Message à dire…"
          style="flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:13px;padding:8px 12px;outline:none"/>
        <button id="ann-quick-btn"
          style="background:#00e5a0;color:#0a0a0a;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">
          <i class="ti ti-send"></i> Envoyer
        </button>
      </div>
    </div>

    <!-- En-tête global + tout activer/désactiver -->
    <div style="display:flex;align-items:center;gap:10px;padding:0 2px">
      <span style="font-size:11px;color:var(--txt3);letter-spacing:1px;flex:1">CATÉGORIES D'ANNONCES</span>
      <button id="ann-all-on"  style="background:rgba(0,229,160,.15);color:#00e5a0;border:1px solid rgba(0,229,160,.3);border-radius:8px;padding:5px 12px;font-size:11px;cursor:pointer">Tout ON</button>
      <button id="ann-all-off" style="background:rgba(255,68,85,.1);color:#ff4455;border:1px solid rgba(255,68,85,.25);border-radius:8px;padding:5px 12px;font-size:11px;cursor:pointer">Tout OFF</button>
    </div>

    <!-- Cartes catégories -->
    ${_ANN_CATS.map(cat => {
      const active = haState(cat.entity) === 'on';
      const unknown = !S._stMap[cat.entity];
      return `
      <div class="ann-card" data-entity="${cat.entity}" style="background:rgba(255,255,255,.04);border:1px solid ${active ? cat.color+'44' : 'rgba(255,255,255,.08)'};border-radius:14px;padding:12px 14px;transition:border .25s">
        <div style="display:flex;align-items:center;gap:10px">
          <!-- Icône -->
          <div style="width:38px;height:38px;border-radius:10px;background:${cat.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="ti ${cat.icon}" style="font-size:18px;color:${cat.color}"></i>
          </div>
          <!-- Label + desc -->
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;font-weight:700;color:var(--txt1)">${cat.label}</span>
              <span class="ann-badge" style="font-size:9px;letter-spacing:1px;font-weight:700;color:${active ? '#00e5a0' : '#666'}">${active ? 'ACTIF' : 'OFF'}</span>
              ${unknown ? '<span style="font-size:9px;color:#888;background:rgba(255,255,255,.07);padding:1px 6px;border-radius:4px">NEW</span>' : ''}
            </div>
            <div style="font-size:10px;color:var(--txt3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat.desc}</div>
          </div>
          <!-- Toggle -->
          <div class="ann-tgl ${active ? 'ann-tgl-on' : ''}" data-entity="${cat.entity}"
            style="position:relative;width:44px;height:24px;border-radius:12px;background:${active ? cat.color : '#333'};cursor:pointer;flex-shrink:0;transition:background .2s;border:1px solid ${active ? cat.color+'99' : '#444'}">
            <div class="ann-tgl-knob" style="position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;transform:translateX(${active ? '20px' : '0'})"></div>
          </div>
        </div>
        <!-- Sensors -->
        ${cat.sensors && cat.sensors.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">
          ${cat.sensors.map(s => `
            <div style="display:flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.05)">
              <div style="width:7px;height:7px;border-radius:50%;background:${_annSensorColor(s.eid)}"></div>
              <span style="font-size:10px;color:var(--txt2)">${s.name}</span>
              <span style="font-size:10px;color:${_annSensorColor(s.eid)}">${_annSensorLabel(s.eid)}</span>
            </div>`).join('')}
        </div>` : ''}
        <!-- Bouton test -->
        ${cat.test ? `
        <div style="margin-top:8px;display:flex;justify-content:flex-end">
          <button class="ann-test-btn" data-msg="${cat.test.replace(/"/g,'&quot;')}"
            style="background:rgba(255,255,255,.07);color:var(--txt2);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:4px 12px;font-size:11px;cursor:pointer">
            <i class="ti ti-player-play" style="font-size:10px"></i> Tester
          </button>
        </div>` : ''}
      </div>`;
    }).join('')}

    <div style="height:16px"></div>
  </div>`;

  container.innerHTML = html;

  // ── Styles toggle ─────────────────────────────────────────────────────────
  if (!document.getElementById('ann-style')) {
    const st = document.createElement('style');
    st.id = 'ann-style';
    st.textContent = `
      .ann-tgl{transition:background .2s,border-color .2s}
      #ann-quick-input:focus{border-color:#00e5a0!important;box-shadow:0 0 0 2px rgba(0,229,160,.15)}
      .ann-test-btn:hover{background:rgba(255,255,255,.12)!important;color:var(--txt1)!important}
      .ann-tgl:hover{opacity:.85}
    `;
    document.head.appendChild(st);
  }

  // ── Envoi rapide ──────────────────────────────────────────────────────────
  const qBtn = document.getElementById('ann-quick-btn');
  const qInp = document.getElementById('ann-quick-input');
  if (qBtn && qInp) {
    qBtn.addEventListener('click', () => {
      const msg = qInp.value.trim();
      if (!msg) return;
      _annSpeak(msg);
      qInp.value = '';
    });
    qInp.addEventListener('keydown', e => { if (e.key === 'Enter') qBtn.click(); });
  }

  // ── Tout ON / Tout OFF ────────────────────────────────────────────────────
  const allOn = document.getElementById('ann-all-on');
  const allOff = document.getElementById('ann-all-off');
  if (allOn) allOn.addEventListener('click', () => {
    _ANN_CATS.forEach(c => { haCall('input_boolean', 'turn_on', {entity_id: c.entity}); });
    showToast('Toutes les annonces activées');
    haScheduleRefresh(1500);
  });
  if (allOff) allOff.addEventListener('click', () => {
    _ANN_CATS.forEach(c => { haCall('input_boolean', 'turn_off', {entity_id: c.entity}); });
    showToast('Toutes les annonces désactivées');
    haScheduleRefresh(1500);
  });

  // ── Toggles par carte ─────────────────────────────────────────────────────
  document.querySelectorAll('.ann-tgl[data-entity]').forEach(tgl => {
    tgl.addEventListener('click', () => {
      const card = tgl.closest('.ann-card');
      _annToggle(tgl.dataset.entity, card);
    });
  });

  // ── Boutons test ──────────────────────────────────────────────────────────
  document.querySelectorAll('.ann-test-btn[data-msg]').forEach(btn => {
    btn.addEventListener('click', () => {
      const msg = btn.dataset.msg;
      _annSpeak(msg);
    });
  });
};
