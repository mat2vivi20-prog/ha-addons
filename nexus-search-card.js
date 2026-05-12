// ╔══════════════════════════════════════════════════════════════╗
// ║  NEXUS SEARCH CARD — Recherche globale style cyber          ║
// ╚══════════════════════════════════════════════════════════════╝
const ICONS = {
  light:'💡',switch:'🔌',climate:'❄️',media_player:'🔊',sensor:'📊',
  binary_sensor:'⬤',camera:'📷',alarm_control_panel:'🛡',input_boolean:'✅',
  automation:'⚙️',cover:'🪟',weather:'⛅',person:'👤',vacuum:'🤖',fan:'💨',
  scene:'🎭',script:'📜',number:'🔢',select:'📋',input_text:'✏️',
  lock:'🔒',water_heater:'🚿',
};
const CSS = `
  :host{display:block}
  .wrap{background:rgba(0,6,16,.95);border:1px solid rgba(0,200,255,.28);border-top:2px solid #00c8ff;
        clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));
        padding:10px 14px 8px}
  .row{display:flex;align-items:center;gap:10px}
  .lbl{font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:3px;
       color:rgba(0,200,255,.5);white-space:nowrap}
  input{flex:1;background:rgba(0,15,32,.9);border:1px solid rgba(0,200,255,.3);border-radius:3px;
        color:#00c8ff;font-family:'Share Tech Mono',monospace;font-size:13px;
        padding:7px 12px;letter-spacing:1px;outline:none;transition:border .2s,box-shadow .2s}
  input::placeholder{color:rgba(0,200,255,.3)}
  input:focus{border-color:rgba(0,200,255,.7);box-shadow:0 0 10px rgba(0,200,255,.18)}
  .cnt{font-family:'Share Tech Mono',monospace;font-size:10px;color:rgba(0,200,255,.5);
       letter-spacing:1px;min-width:80px;text-align:right;white-space:nowrap}
  .results{margin-top:6px;max-height:300px;overflow-y:auto}
  .results::-webkit-scrollbar{width:3px}
  .results::-webkit-scrollbar-thumb{background:rgba(0,200,255,.3);border-radius:2px}
  .item{display:grid;grid-template-columns:22px 1fr auto auto;align-items:center;gap:8px;
        padding:7px 6px;cursor:pointer;border-bottom:1px solid rgba(0,200,255,.06);transition:background .12s}
  .item:hover{background:rgba(0,200,255,.08)}
  .item:last-child{border-bottom:none}
  .ico{text-align:center;font-size:14px}
  .name{font-family:'Rajdhani',sans-serif;font-size:14px;color:rgba(168,216,234,.9);
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .eid{font-family:'Share Tech Mono',monospace;font-size:10px;color:rgba(0,200,255,.35);
       overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .state{font-family:'Share Tech Mono',monospace;font-size:11px;color:rgba(0,200,255,.7);
         white-space:nowrap;text-align:right}
  .state.on{color:#00ff88}.state.off{color:rgba(168,216,234,.35)}
  .state.unavailable{color:#ff4466}.state.unknown{color:#ffaa00}
  .empty{text-align:center;color:rgba(0,200,255,.3);font-family:'Share Tech Mono',monospace;
         font-size:11px;padding:18px;letter-spacing:2px}
  mark{background:rgba(0,200,255,.2);color:#00c8ff;border-radius:2px;padding:0 1px}
`;

class NexusSearchCard extends HTMLElement {
  constructor(){ super(); this._q=''; this.attachShadow({mode:'open'}); }

  set hass(h){ this._hass=h; if(this._q.length>=2) this._search(this._q); }
  setConfig(c){ this._cfg=c; this._build(); }

  _build(){
    this.shadowRoot.innerHTML=`<style>${CSS}</style>
<div class="wrap">
  <div class="row">
    <span class="lbl">🔍 RECHERCHE</span>
    <input type="search" placeholder="Nom d'appareil, entité..." autocomplete="off" spellcheck="false"/>
    <span class="cnt"></span>
  </div>
  <div class="results"></div>
</div>`;
    this.shadowRoot.querySelector('input').addEventListener('input',e=>{
      this._q=e.target.value; this._search(this._q);
    });
  }

  _hl(txt, q){
    if(!q) return txt;
    const i=txt.toLowerCase().indexOf(q.toLowerCase());
    if(i<0) return txt;
    return txt.slice(0,i)+'<mark>'+txt.slice(i,i+q.length)+'</mark>'+txt.slice(i+q.length);
  }

  _search(q){
    const res=this.shadowRoot.querySelector('.results');
    const cnt=this.shadowRoot.querySelector('.cnt');
    if(!q||q.length<2){res.innerHTML='';cnt.textContent='';return;}
    if(!this._hass){return;}
    const ql=q.toLowerCase();
    const hits=Object.values(this._hass.states)
      .filter(s=>{
        const n=(s.attributes.friendly_name||'').toLowerCase();
        return n.includes(ql)||s.entity_id.toLowerCase().includes(ql);
      })
      .sort((a,b)=>{
        const an=(a.attributes.friendly_name||a.entity_id).toLowerCase();
        const bn=(b.attributes.friendly_name||b.entity_id).toLowerCase();
        return (an.indexOf(ql)-bn.indexOf(ql))||an.localeCompare(bn);
      })
      .slice(0,20);

    cnt.textContent=hits.length?`${hits.length} résultat${hits.length>1?'s':''}`:''  ;
    if(!hits.length){
      res.innerHTML=`<div class="empty">▸ AUCUN RÉSULTAT POUR «&nbsp;${q.toUpperCase()}&nbsp;»</div>`;
      return;
    }
    res.innerHTML=hits.map(s=>{
      const n=s.attributes.friendly_name||s.entity_id;
      const d=s.entity_id.split('.')[0];
      const ico=ICONS[d]||'●';
      const sc=s.state;
      return `<div class="item" data-id="${s.entity_id}">
        <span class="ico">${ico}</span>
        <div><div class="name">${this._hl(n,q)}</div>
             <div class="eid">${s.entity_id.split('.')[1]}</div></div>
        <span class="state ${sc}">${sc}</span>
      </div>`;
    }).join('');
    this.shadowRoot.querySelectorAll('.item').forEach(el=>{
      el.addEventListener('click',()=>
        this.dispatchEvent(new CustomEvent('hass-more-info',
          {composed:true,bubbles:true,detail:{entityId:el.dataset.id}}))
      );
    });
  }
  getCardSize(){return this._q.length>=2?5:2;}
}
customElements.define('nexus-search-card',NexusSearchCard);
