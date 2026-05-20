// ══════════════════════════════════════════════════════════════
// Bilgi Güvenliği Gap Analizi v4
// 5 Sekme: Sorular | Bulgular | Uyumluluk | 1296 Tedbir | Özet
// ══════════════════════════════════════════════════════════════

const STORAGE_KEY  = 'bg_gap_v4';
const API_KEY_STOR = 'bg_gemini_key';
const PUAN = { evet: 1, kismi: 0.5, hayir: 0 };
const PAGE_SIZE_1296 = 50;

const STATE = {
  cevaplar: {},       // {q_id: {c, obs, bulgu}} — 100 soru
  cevaplar1296: {},   // {tedbir_indeks: 'evet'|'kismi'|'hayir'} — mapping
  currentIdx: 0,
  activeFilter: 'all',
  activePage: 'sorular',
  page1296: 0
};

const CATEGORIES = [...new Set(SORULAR_100.map(s => s.anaKat))];

// ── STORAGE ────────────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cevaplar: STATE.cevaplar,
      cevaplar1296: STATE.cevaplar1296
    }));
  } catch(e) {}
}
function load() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (!r) return;
    const d = JSON.parse(r);
    STATE.cevaplar = d.cevaplar || {};
    STATE.cevaplar1296 = d.cevaplar1296 || {};
  } catch(e) {}
}

// ── UTILS ──────────────────────────────────────────────────────
function shortCat(c) { return c.replace(/^\d+\.\d+\.\s*/, ''); }
function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast visible ' + type;
  setTimeout(() => t.classList.remove('visible'), 3000);
}
function critBadge(k) {
  if (k===3) return `<span class="badge badge-red">🔴 Yüksek</span>`;
  if (k===2) return `<span class="badge badge-amber">🟡 Orta</span>`;
  return `<span class="badge badge-gray">⚪ Düşük</span>`;
}
function lkp(type, id) { return (id >= 0 && LOOKUPS[type]) ? (LOOKUPS[type][id] || '') : ''; }
function cevapLabel(c) {
  return {evet:'Tamamen Uygulanıyor', kismi:'Kısmen Uygulanıyor', hayir:'Uygulanmıyor'}[c] || '—';
}

function riskDurumu(q, cevap) {
  const k = q.kritiklik;
  if (cevap === 'evet') return null;
  if (cevap === 'hayir') {
    if (k===3) return {label:'Çok Riskli', cls:'dk-risk-cok-riskli', skor:12};
    if (k===2) return {label:'Riskli', cls:'dk-risk-riskli', skor:8};
    return {label:'Orta Riskli', cls:'dk-risk-orta', skor:4};
  }
  if (cevap === 'kismi') {
    if (k===3) return {label:'Riskli', cls:'dk-risk-riskli', skor:6};
    if (k===2) return {label:'Orta Riskli', cls:'dk-risk-orta', skor:3};
    return {label:'Orta Riskli', cls:'dk-risk-orta', skor:2};
  }
  return null;
}

// 1296 propagation: 100. soruya verilen cevabı ilgili tüm tedbirlere yansıt
function propagate1296(q100, cevap) {
  SORULAR_1296.forEach(s => {
    if (s.p === q100.id) {
      STATE.cevaplar1296[s.i] = cevap;
    }
  });
}

// ── TABS ───────────────────────────────────────────────────────
function switchTab(name) {
  STATE.activePage = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  if (name === 'rapor') renderRapor();
  if (name === 'uyumlu') renderUyumlu();
  if (name === 'tedbirler') { initTedbirFilters(); render1296(); }
  if (name === 'ozet') renderOzet();
}

// ══════════════════════════════════════════════════════════════
// SAYFA 1: SORULAR
// ══════════════════════════════════════════════════════════════

function buildSidebar() {
  const sb = document.getElementById('sidebar');
  let h = `<div class="sidebar-title">Kategoriler</div>`;
  h += `<div class="cat-item active" onclick="filterCat('all',this)">
    <div class="cat-label">📋 Tüm Sorular</div>
    <div class="cat-badge">${SORULAR_100.length}</div>
  </div>`;
  CATEGORIES.forEach((c, i) => {
    const count = SORULAR_100.filter(s => s.anaKat === c).length;
    const hasBulgu = SORULAR_100.filter(s => s.anaKat === c).some(s => {
      const cv = STATE.cevaplar[s.id];
      return cv && (cv.c === 'hayir' || cv.c === 'kismi');
    });
    h += `<div class="cat-item ${hasBulgu ? 'has-bulgu' : ''}" onclick="filterCat('${c.replace(/'/g,"\\'")}',this)" id="cat-${i}" title="${c}">
      <div class="cat-label">${shortCat(c)}</div>
      <div class="cat-badge">${count}</div>
    </div>`;
  });
  sb.innerHTML = h;
}

function filterCat(cat, el) {
  STATE.activeFilter = cat;
  document.querySelectorAll('.cat-item').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const list = filteredList();
  if (list.length) STATE.currentIdx = SORULAR_100.indexOf(list[0]);
  renderQuestion();
save();
}

function filteredList() {
  return STATE.activeFilter === 'all' ? SORULAR_100 : SORULAR_100.filter(s => s.anaKat === STATE.activeFilter);
}

function navigate(dir) {
  const list = filteredList();
  const pos = list.findIndex(s => s === SORULAR_100[STATE.currentIdx]);
  const np = pos + dir;
  if (np >= 0 && np < list.length) {
    STATE.currentIdx = SORULAR_100.indexOf(list[np]);
    renderQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
save();
}

function renderQuestion() {
  const q = SORULAR_100[STATE.currentIdx];
  const list = filteredList();
  const pos = list.findIndex(s => s === q);
  document.getElementById('q-nav-info').textContent = `Soru ${pos + 1} / ${list.length}`;
  document.getElementById('prev-btn').disabled = pos <= 0;
  document.getElementById('next-btn').disabled = pos >= list.length - 1;
  document.getElementById('q-section-label').textContent = q.altKat;

  const cv  = STATE.cevaplar[q.id] || null;
  const sel = cv ? cv.c : null;
  const obs = cv ? (cv.obs || '') : '';
  const bulgu = cv ? (cv.bulgu || '') : '';

  const mev  = lkp('mev', q.mev);
  const iso1 = lkp('iso1', q.iso1);
  const iso2 = lkp('iso2', q.iso2);
  const iso3 = lkp('iso3', q.iso3);

  let refsHTML = '<div class="q-refs">';
  if (iso1) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 27001:2022</span><span class="ref-value">${iso1.replace(/\n/g,', ')}</span></span>`;
  if (iso2) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 27701:2019</span><span class="ref-value">${iso2.replace(/\n/g,', ')}</span></span>`;
  if (iso3) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 20000-1</span><span class="ref-value">${iso3.replace(/\n/g,', ')}</span></span>`;
  if (mev)  refsHTML += `<div class="ref-mev"><span class="ref-label">Mevzuat</span><span class="ref-mev-text">${mev}</span></div>`;
  refsHTML += '</div>';

  const borderColor = sel==='evet' ? 'rgba(16,185,129,0.3)' : sel==='kismi' ? 'rgba(245,158,11,0.3)' : sel==='hayir' ? 'rgba(239,68,68,0.3)' : '';
  const bgColor     = sel==='evet' ? 'rgba(16,185,129,0.06)' : sel==='kismi' ? 'rgba(245,158,11,0.06)' : sel==='hayir' ? 'rgba(239,68,68,0.06)' : '';
  const panelColor  = sel==='evet' ? '#10b981' : sel==='kismi' ? '#f59e0b' : '#f87171';
  const panelTitle  = sel==='evet' ? '✅ Uygulama Notları' : sel==='kismi' ? '🟡 Danışman Gözlemi' : '❌ Tespit Notları';
  const panelDesc   = sel==='evet' ? 'Kontrolün nasıl uygulandığını, kanıtları ve gözlemlerinizi yazın.'
                    : sel==='kismi' ? 'Mevcut durumu açıklayın. Bu metinden otomatik bulgu üretilecektir.'
                    : 'Kontrolün neden uygulanmadığını, tespit edilen eksikliği yazın.';

  document.getElementById('q-area').innerHTML = `
    <div class="q-card">
      <div class="q-meta">
        <span class="q-num">${q.tedbirNo} • S${q.id}</span>
        ${critBadge(q.kritiklik)}
        <span class="q-tedbir-label" title="${q.tedbir}">${q.tedbir}</span>
      </div>
      <div class="q-text">${q.soru}</div>
      ${refsHTML}
      <div class="answer-row">
        <button class="ans ${sel==='evet'?'sel-evet':''}" onclick="setCevap('evet')">
          <span class="ans-icon">✅</span>
          <span class="ans-label">Evet</span>
          <span class="ans-desc">Tamamen uygulanıyor</span>
        </button>
        <button class="ans ${sel==='kismi'?'sel-kismi':''}" onclick="setCevap('kismi')">
          <span class="ans-icon">🟡</span>
          <span class="ans-label">Kısmen</span>
          <span class="ans-desc">Eksik veya kısmi uygulama</span>
        </button>
        <button class="ans ${sel==='hayir'?'sel-hayir':''}" onclick="setCevap('hayir')">
          <span class="ans-icon">❌</span>
          <span class="ans-label">Hayır</span>
          <span class="ans-desc">Uygulanmıyor</span>
        </button>
      </div>
      ${sel ? `
      <div style="margin-top:1rem;padding:1.25rem;border-radius:10px;border:1px solid ${borderColor};background:${bgColor}">
        <div style="font-size:12px;font-weight:600;margin-bottom:5px;color:${panelColor}">${panelTitle}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:7px">${panelDesc}</div>
        <textarea id="kismi-obs" style="width:100%;min-height:85px;padding:9px;background:var(--bg);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:var(--text);font-size:13px;line-height:1.6;resize:vertical;font-family:inherit" placeholder="Gözlem notlarınızı buraya yazın...">${obs}</textarea>
        <div style="display:flex;gap:7px;margin-top:7px;justify-content:flex-end">
          ${sel !== 'evet' ? `<button class="btn-ai" id="ai-gen-btn" onclick="bulguUret()" ${!obs.trim()?'disabled':''}>🤖 Bulgu Üret</button>` : ''}
        </div>
        ${bulgu ? `
        <div style="background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);border-radius:7px;padding:.9rem;margin-top:.6rem">
          <div style="font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:.35rem">🤖 Üretilen Bulgu</div>
          <div style="font-size:12px;color:var(--text);line-height:1.6;white-space:pre-line">${bulgu}</div>
        </div>` : '<div id="bulgu-preview"></div>'}
      </div>` : ''}
    </div>`;

  const ta = document.getElementById('kismi-obs');
  if (ta) {
    ta.addEventListener('input', () => {
      if (!STATE.cevaplar[q.id]) STATE.cevaplar[q.id] = { c: sel, obs: '', bulgu: '' };
      STATE.cevaplar[q.id].obs = ta.value;
      save();
      const btn = document.getElementById('ai-gen-btn');
      if (btn) btn.disabled = !ta.value.trim();
    });
  }
}

function setCevap(val) {
  const q = SORULAR_100[STATE.currentIdx];
  const mevcut = STATE.cevaplar[q.id] || {};
  STATE.cevaplar[q.id] = {
    c: val,
    obs: mevcut.obs || '',
    bulgu: val === 'evet' ? '' : (mevcut.bulgu || '')
  };
  propagate1296(q, val);
  save();
  updateStats();
  buildSidebar();
  renderQuestion();
}

function bulguUret() {
  const q = SORULAR_100[STATE.currentIdx];
  const ta = document.getElementById('kismi-obs');
  if (!ta || !ta.value.trim()) { toast('Gözlem metni boş olamaz', 'error'); return; }
  const apiKey = localStorage.getItem(API_KEY_STOR);
  if (!apiKey) { showAPIKeyModal(); return; }

  const obs  = ta.value.trim();
  const btn  = document.getElementById('ai-gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Üretiliyor...';

  const mev  = lkp('mev', q.mev);
  const iso1 = lkp('iso1', q.iso1);

  const prompt = `Sen kıdemli bir BİGR ve KVKK baş denetçisisin. Aşağıdaki denetim kontrolü için danışman gözlemine dayalı profesyonel bulgu metni yaz.

KONTROL:
- Tedbir No: ${q.tedbirNo} | Tedbir: ${q.tedbir}
- Kategori: ${q.altKat} | Kritiklik: ${q.kritiklik===3?'Yüksek':q.kritiklik===2?'Orta':'Düşük'}
- Mevzuat: ${mev || 'BİGR Kapsamı'}
${iso1 ? `- ISO 27001:2022: ${iso1.replace(/\n/g,', ')}` : ''}
- BİGR Öneri: ${q.oneri || 'Standarda uygun uygulama'}

DANIŞMAN GÖZLEMI: "${obs}"

Türkçe, 3-4 cümle, resmi denetim üslubunda bulgu metni yaz. Sadece metni yaz, başlık veya açıklama ekleme.`;

  fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 800 } })
  })
  .then(r => { if (!r.ok) throw new Error(`API ${r.status}`); return r.json(); })
  .then(data => {
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';
    STATE.cevaplar[q.id].bulgu = text.trim();
    save();
    const pv = document.getElementById('bulgu-preview');
    if (pv) pv.innerHTML = `
      <div style="background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);border-radius:7px;padding:.9rem;margin-top:.6rem">
        <div style="font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:.35rem">🤖 Üretilen Bulgu</div>
        <div style="font-size:12px;color:var(--text);line-height:1.6;white-space:pre-line">${text.trim()}</div>
      </div>`;
    toast('✅ Bulgu metni üretildi', 'success');
  })
  .catch(e => toast('AI hatası: ' + e.message, 'error'))
  .finally(() => { btn.disabled = false; btn.innerHTML = '🤖 Bulgu Üret'; });
}

function updateStats() {
  const all   = Object.values(STATE.cevaplar);
  const evet  = all.filter(v => v.c === 'evet').length;
  const kismi = all.filter(v => v.c === 'kismi').length;
  const hayir = all.filter(v => v.c === 'hayir').length;
  const total = evet + kismi + hayir;
  const skor  = total > 0 ? Math.round(100*(evet + kismi*0.5)/total) : null;
  const covered1296 = Object.keys(STATE.cevaplar1296).length;

  document.getElementById('h-evet').textContent  = evet;
  document.getElementById('h-kismi').textContent = kismi;
  document.getElementById('h-hayir').textContent = hayir;
  document.getElementById('h-score').textContent = skor !== null ? skor + '%' : '—';
  document.getElementById('prog').style.width    = Math.round(100*total/100) + '%';
  document.getElementById('badge-sorular').textContent  = total + '/100';
  document.getElementById('badge-rapor').textContent    = (hayir + kismi) + ' Bulgu';
  document.getElementById('badge-uyumlu').textContent   = evet;
  document.getElementById('badge-tedbirler').textContent = covered1296 + '/1296';
}

// ══════════════════════════════════════════════════════════════
// SAYFA 2: BULGULAR
// ══════════════════════════════════════════════════════════════

function renderRapor() {
  const filter = document.getElementById('rapor-filter')?.value || 'all';
  let sorular = SORULAR_100.filter(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv || cv.c === 'evet') return false;
    if (filter === 'hayir')     return cv.c === 'hayir';
    if (filter === 'kismi')     return cv.c === 'kismi';
    if (filter === 'cokriskli') return riskDurumu(q, cv.c)?.label === 'Çok Riskli';
    if (filter === 'riskli')    return riskDurumu(q, cv.c)?.label === 'Riskli';
    return true;
  });
  sorular.sort((a, b) => (riskDurumu(b, STATE.cevaplar[b.id].c)?.skor || 0) - (riskDurumu(a, STATE.cevaplar[a.id].c)?.skor || 0));

  const liste = document.getElementById('rapor-liste');
  const bos   = document.getElementById('rapor-bos');
  if (!sorular.length) { liste.innerHTML = ''; bos.style.display = 'block'; return; }
  bos.style.display = 'none';
  liste.innerHTML = sorular.map(q => buildDanismanKart(q)).join('');
}

function buildDanismanKart(q) {
  const cv  = STATE.cevaplar[q.id];
  const rd  = riskDurumu(q, cv.c);
  const mev = lkp('mev', q.mev);
  const iso1= lkp('iso1', q.iso1);
  const iso2= lkp('iso2', q.iso2);
  const iso3= lkp('iso3', q.iso3);

  // Tespit
  let tespitMetni = '';
  if (cv.c === 'kismi' && cv.bulgu) tespitMetni = cv.bulgu;
  else if (cv.c === 'kismi' && cv.obs) tespitMetni = `Denetim kapsamında "${q.tedbir}" alanında kısmi uygulama tespit edilmiştir. Danışman notu: ${cv.obs}`;
  else if (cv.c === 'hayir') tespitMetni = `Yapılan incelemede, "${q.tedbir}" kapsamındaki gereklilikler kurumda uygulanmamaktadır. ${q.altKat} alanına ilişkin tanımlı bir süreç veya kontrol mekanizması bulunmamaktadır. Bu durum BİGR rehberinin ${q.tedbirNo} numaralı tedbir maddesine doğrudan aykırılık teşkil etmektedir.`;
  else tespitMetni = `Kısmen uygulama durumu tespit edilmiştir. Detaylı gözlem notu eklenmemiştir.`;

  // Risk
  const etkisel = cv.c === 'hayir'
    ? (q.kritiklik===3 ? 'Tedbirin hiç uygulanmaması kuruma ciddi operasyonel, yasal ve itibar riski oluşturmaktadır.'
     : q.kritiklik===2 ? 'Tedbirin eksikliği, kurum varlıkları ve kişisel veriler üzerinde önemli risk yaratmaktadır.'
     : 'Orta düzey operasyonel risk söz konusudur.')
    : (q.kritiklik===3 ? 'Kısmi uygulama, tam güvence sağlamamakta; kontrol etkinliği yetersiz kalmaktadır.'
     : 'Sürecin olgunlaşması için ek adım atılması gerekmektedir.');

  const hukukiRisk = `* ${q.tedbirNo} | ${cv.c==='hayir'?'Olası Riskler: ':'Kısmi Risk: '}${q.kritiklik===3?'Yüksek':q.kritiklik===2?'Orta':'Düşük'} Kritiklik (${q.kritiklik*(cv.c==='hayir'?4:3)} Puan)${mev ? `\n\n* Hukuki Yaptırım:\n${mev}` : ''}`;

  // Mevzuat
  let mevzuatHTML = '';
  if (mev) mevzuatHTML += `<div class="dk-mev-item"><div class="dk-mev-baslik">📜 İlgili Mevzuat</div><div class="dk-mev-text">${mev}</div></div>`;
  if (iso1||iso2||iso3) {
    mevzuatHTML += `<div class="dk-mev-item"><div class="dk-mev-baslik">🏷 Standart Referanslar</div><div>`;
    if (iso1) iso1.split('\n').filter(Boolean).forEach(v => { mevzuatHTML += `<span class="dk-mev-iso">ISO 27001:2022 ${v.trim()}</span>`; });
    if (iso2) iso2.split('\n').filter(Boolean).forEach(v => { mevzuatHTML += `<span class="dk-mev-iso">ISO 27701 ${v.trim()}</span>`; });
    if (iso3) iso3.split('\n').filter(Boolean).forEach(v => { mevzuatHTML += `<span class="dk-mev-iso">ISO 20000 ${v.trim()}</span>`; });
    mevzuatHTML += `</div></div>`;
  }
  if (!mevzuatHTML) mevzuatHTML = `<div class="dk-mev-text" style="color:#9ca3af">BİGR ${q.tedbirNo} kapsamında değerlendirilmektedir.</div>`;

  // Öneriler
  const oneriLines = (q.oneri || '').split(/\n|•|-/).map(s => s.trim()).filter(s => s.length > 15);
  let oneriHTML = '';
  if (oneriLines.length > 0) {
    oneriLines.slice(0, 6).forEach((line, i) => {
      oneriHTML += `<div class="dk-oneri-item"><div class="dk-oneri-no">${i+1}</div><div class="dk-oneri-text">${line}</div></div>`;
    });
  } else {
    oneriHTML = `<div class="dk-oneri-item"><div class="dk-oneri-no">1</div><div class="dk-oneri-text">${q.oneri || 'Kontrol mekanizması oluşturularak dokümante edilmelidir.'}</div></div>`;
  }

  return `
<div class="danisman-kart" id="kart-${q.id}">
  <div class="dk-header">
    <div>
      <div class="dk-ustbaslik">Danışmanlık Görüşü</div>
      <div class="dk-baslik">${q.altKat} — ${q.tedbir}</div>
    </div>
    <span class="dk-risk-badge ${rd?.cls||'dk-risk-orta'}">${rd?.label||'Orta Riskli'}</span>
  </div>
  <div class="dk-body">
    <div class="dk-kolon">
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">🔍</span> Tespitler</div>
      <div class="dk-tespit-text">${tespitMetni}</div>
    </div>
    <div class="dk-kolon">
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">⚠️</span> Risk Analizi</div>
      <div class="dk-risk-item"><span class="dk-risk-label etkisel">Etki (${q.kritiklik*(cv.c==='hayir'?4:3)})</span><div class="dk-risk-text">${etkisel}</div></div>
      <div class="dk-risk-item"><span class="dk-risk-label kritiklik">Kritiklik (${q.kritiklik*4})</span><div class="dk-risk-text">BİGR kritiklik: <strong>${q.kritiklik===3?'Yüksek':q.kritiklik===2?'Orta':'Düşük'}</strong></div></div>
      <div class="dk-risk-item"><span class="dk-risk-label hukuki">Hukuki</span><div class="dk-risk-text" style="white-space:pre-line">${hukukiRisk}</div></div>
    </div>
    <div class="dk-kolon">
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">⚖️</span> Mevzuat Uyumu</div>
      ${mevzuatHTML}
    </div>
    <div class="dk-kolon">
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">💡</span> İyileştirme Önerileri</div>
      ${oneriHTML}
    </div>
  </div>
  <div class="dk-footer">
    <span class="dk-footer-no">${q.tedbirNo} • S${q.id}/100 • ${q.kapsananSayi} Tedbir</span>
    <div style="display:flex;gap:7px;align-items:center">
      ${cv.c==='kismi'&&cv.bulgu ? '<span class="dk-ai-badge">🤖 AI Bulgu</span>' : ''}
      <span>${cv.c==='hayir'?'❌ Uygulanmıyor':'🟡 Kısmen'}</span>
    </div>
  </div>
</div>`;
}

// ══════════════════════════════════════════════════════════════
// SAYFA 3: UYUMLULUK KANITLARI
// ══════════════════════════════════════════════════════════════

function renderUyumlu() {
  const filter = document.getElementById('uyumlu-filter')?.value || 'all';
  let sorular = SORULAR_100.filter(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv || cv.c !== 'evet') return false;
    if (filter === 'notlu')  return cv.obs && cv.obs.trim();
    if (filter === 'notsuz') return !cv.obs || !cv.obs.trim();
    return true;
  });

  const liste = document.getElementById('uyumlu-liste');
  const bos   = document.getElementById('uyumlu-bos');

  if (!sorular.length) {
    liste.innerHTML = '';
    bos.style.display = 'block';
    return;
  }
  bos.style.display = 'none';

  let html = `<div style="font-size:13px;color:var(--text2);margin-bottom:1rem">${sorular.length} uyumlu kontrol • ${sorular.filter(q => STATE.cevaplar[q.id]?.obs?.trim()).length} tanesi uygulama notu içeriyor</div>`;
  html += '<div class="uyumlu-grid">';
  sorular.forEach(q => {
    const cv = STATE.cevaplar[q.id];
    const obs = cv.obs || '';
    const iso1 = lkp('iso1', q.iso1);
    html += `<div class="uyumlu-kart">
      <div class="uk-header">
        <div class="uk-baslik">${q.tedbir}</div>
        <span class="uk-badge">${critBadge(q.kritiklik).replace(/<[^>]+>/g,'').trim()}</span>
      </div>
      <div class="uk-meta">${q.tedbirNo} • ${shortCat(q.altKat)}</div>
      ${iso1 ? `<div style="margin-bottom:.5rem">${iso1.split('\n').filter(Boolean).map(v=>`<span class="dk-mev-iso" style="background:#0d1521">ISO 27001 ${v.trim()}</span>`).join('')}</div>` : ''}
      ${obs.trim()
        ? `<div class="uk-not-label">📝 Danışman Uygulama Notu</div><div class="uk-not-text">${obs}</div>`
        : `<div class="uk-no-not">Uygulama notu eklenmemiş</div>`}
      <div class="uk-tedbir-sayi">📊 ${q.kapsananSayi} tedbiri kapsıyor</div>
    </div>`;
  });
  html += '</div>';
  liste.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
// SAYFA 4: 1296 TEDBİR
// ══════════════════════════════════════════════════════════════

function initTedbirFilters() {
  const catSel = document.getElementById('t-cat-filter');
  if (catSel && catSel.options.length <= 1) {
    CATEGORIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = shortCat(c);
      catSel.appendChild(opt);
    });
  }
}

function getFiltered1296() {
  const cat    = document.getElementById('t-cat-filter')?.value || 'all';
  const cevap  = document.getElementById('t-cevap-filter')?.value || 'all';
  const search = (document.getElementById('t-search')?.value || '').toLowerCase().trim();

  return SORULAR_1296.filter(s => {
    if (cat !== 'all' && s.ak !== cat) return false;
    const cv = STATE.cevaplar1296[s.i];
    if (cevap === 'evet'  && cv !== 'evet')  return false;
    if (cevap === 'kismi' && cv !== 'kismi') return false;
    if (cevap === 'hayir' && cv !== 'hayir') return false;
    if (cevap === 'bos'   && cv) return false;
    if (search && !(s.q?.toLowerCase().includes(search) || s.ta?.toLowerCase().includes(search) || s.tn?.toLowerCase().includes(search))) return false;
    return true;
  });
}

function render1296() {
  const filtered = getFiltered1296();
  const total    = filtered.length;
  const page     = STATE.page1296;
  const start    = page * PAGE_SIZE_1296;
  const slice    = filtered.slice(start, start + PAGE_SIZE_1296);

  document.getElementById('t-count').textContent = total.toLocaleString('tr-TR') + ' sonuç';

  // İstatistik kartları
  const allCevaplar1296 = Object.values(STATE.cevaplar1296);
  const st = {
    evet:  allCevaplar1296.filter(c => c==='evet').length,
    kismi: allCevaplar1296.filter(c => c==='kismi').length,
    hayir: allCevaplar1296.filter(c => c==='hayir').length,
    bos:   SORULAR_1296.length - allCevaplar1296.length
  };
  document.getElementById('t-stats').innerHTML = `
    <div class="t-stats-kart"><div class="val" style="color:var(--green)">${st.evet}</div><div class="lbl">Uyumlu</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--amber)">${st.kismi}</div><div class="lbl">Kısmen</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--red)">${st.hayir}</div><div class="lbl">Uyumsuz</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--gray)">${st.bos}</div><div class="lbl">Cevapsız</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--teal)">${SORULAR_1296.length - st.bos}</div><div class="lbl">Toplam Cevaplanan</div></div>`;

  // Tablo
  let tbody = '';
  if (!slice.length) {
    tbody = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text2)">Sonuç bulunamadı</td></tr>`;
  } else {
    slice.forEach(s => {
      const cv = STATE.cevaplar1296[s.i];
      const cvCls = cv ? `tc-${cv}` : 'tc-bos';
      const cvLbl = cv ? cevapLabel(cv) : '—';
      // Hangi 100. sorudan geldiği
      const parentQ = SORULAR_100.find(q => q.id === s.p);
      tbody += `<tr>
        <td class="t-tn">${s.tn}</td>
        <td style="font-size:11px;color:var(--text2)">${shortCat(s.altk)}</td>
        <td style="font-size:11px">${s.ta}</td>
        <td style="font-size:11px;color:var(--text2)">${s.q}</td>
        <td><span class="t-cevap-badge ${cvCls}">${cvLbl}</span></td>
        <td class="t-source" title="${parentQ ? parentQ.soru.substring(0,80) : ''}">S${s.p}</td>
      </tr>`;
    });
  }
  document.getElementById('t-body').innerHTML = tbody;

  // Pagination
  const totalPages = Math.ceil(total / PAGE_SIZE_1296);
  let pgHtml = '';
  if (totalPages > 1) {
    const maxBtn = 7;
    let pages = [];
    if (totalPages <= maxBtn) {
      pages = Array.from({length: totalPages}, (_, i) => i);
    } else {
      pages = [0];
      if (page > 2) pages.push('...');
      for (let i = Math.max(1, page-1); i <= Math.min(totalPages-2, page+1); i++) pages.push(i);
      if (page < totalPages-3) pages.push('...');
      pages.push(totalPages-1);
    }
    if (page > 0) pgHtml += `<button class="pg-btn" onclick="goPage1296(${page-1})">← Önceki</button>`;
    pages.forEach(p => {
      if (p === '...') pgHtml += `<span style="padding:6px 4px;color:var(--text3)">…</span>`;
      else pgHtml += `<button class="pg-btn ${p===page?'active':''}" onclick="goPage1296(${p})">${p+1}</button>`;
    });
    if (page < totalPages-1) pgHtml += `<button class="pg-btn" onclick="goPage1296(${page+1})">Sonraki →</button>`;
    pgHtml += `<span style="font-size:12px;color:var(--text2);margin-left:8px">${start+1}–${Math.min(start+PAGE_SIZE_1296, total)} / ${total}</span>`;
  }
  const pgEl = document.getElementById('t-pagination');
  pgEl.innerHTML = pgHtml;
  pgEl.className = 't-pagination';
  if (totalPages > 1) pgEl.style.display = 'flex';
}

function goPage1296(p) {
  STATE.page1296 = p;
  render1296();
  document.getElementById('page-tedbirler').scrollTo({ top: 0, behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════════
// SAYFA 5: YÖNETİM ÖZETİ
// ══════════════════════════════════════════════════════════════

let pieChart = null, barChart = null;

function renderOzet() {
  document.getElementById('ozet-tarih').textContent =
    new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' }) + ' tarihi itibarıyla';

  const all   = Object.values(STATE.cevaplar);
  const evet  = all.filter(v => v.c==='evet').length;
  const kismi = all.filter(v => v.c==='kismi').length;
  const hayir = all.filter(v => v.c==='hayir').length;
  const total = evet + kismi + hayir;
  const skor  = total > 0 ? Math.round(100*(evet+kismi*0.5)/total) : 0;

  const kapsamQ       = SORULAR_100.filter(q => STATE.cevaplar[q.id]);
  const tedbirEvet    = kapsamQ.filter(q => STATE.cevaplar[q.id].c==='evet').reduce((s,q) => s+q.kapsananSayi, 0);
  const tedbirKismi   = kapsamQ.filter(q => STATE.cevaplar[q.id].c==='kismi').reduce((s,q) => s+q.kapsananSayi, 0);
  const tedbirHayir   = kapsamQ.filter(q => STATE.cevaplar[q.id].c==='hayir').reduce((s,q) => s+q.kapsananSayi, 0);
  const covered1296   = Object.keys(STATE.cevaplar1296).length;

  document.getElementById('ozet-grid').innerHTML = `
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--teal)">${skor}%</div><div class="ozet-kart-lbl">Genel Uyum Skoru</div><div class="ozet-kart-sub">${total}/100 yanıtlandı</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--green)">${evet}</div><div class="ozet-kart-lbl">Uyumlu</div><div class="ozet-kart-sub">${tedbirEvet} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--amber)">${kismi}</div><div class="ozet-kart-lbl">Kısmen</div><div class="ozet-kart-sub">${tedbirKismi} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--red)">${hayir}</div><div class="ozet-kart-lbl">Uyumsuz</div><div class="ozet-kart-sub">${tedbirHayir} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--purple)">${kismi+hayir}</div><div class="ozet-kart-lbl">Toplam Bulgu</div><div class="ozet-kart-sub">Raporda yer alan</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--teal)">${covered1296}</div><div class="ozet-kart-lbl">1296 Tedbir</div><div class="ozet-kart-sub">Cevaplanan</div></div>`;

  buildPie(evet, kismi, hayir);
  buildBar();
  buildRiskMatris();
  buildKritikBulgular();
}

function buildPie(e, k, h) {
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('chart-pie'), {
    type: 'doughnut',
    data: { labels: ['Uyumlu','Kısmen','Uyumsuz'], datasets: [{ data: [e,k,h], backgroundColor: ['#10b981','#f59e0b','#ef4444'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 10, usePointStyle: true } } } }
  });
}

function buildBar() {
  const labels = CATEGORIES.map(c => shortCat(c).substring(0, 25));
  const data   = CATEGORIES.map(cat => {
    const qs = SORULAR_100.filter(q => q.anaKat === cat && STATE.cevaplar[q.id]);
    if (!qs.length) return 0;
    return Math.round(100 * qs.reduce((s, q) => s + (PUAN[STATE.cevaplar[q.id].c] || 0), 0) / qs.length);
  });
  const colors = data.map(d => d >= 70 ? '#10b981' : d >= 40 ? '#f59e0b' : d > 0 ? '#ef4444' : '#475569');
  const h = Math.max(300, CATEGORIES.length * 32 + 60);
  document.getElementById('chart-bar-wrap').style.height = h + 'px';
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('chart-bar'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8', callback: v => v+'%' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` Uyum: %${c.raw}` } } }
    }
  });
}

function buildRiskMatris() {
  const m = { '1-kismi':0,'2-kismi':0,'3-kismi':0,'1-hayir':0,'2-hayir':0,'3-hayir':0 };
  SORULAR_100.forEach(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv || cv.c==='evet') return;
    const key = `${q.kritiklik}-${cv.c}`;
    if (key in m) m[key]++;
  });
  const cell = (key, cls) => {
    const n = m[key];
    return `<div class="rm-cell ${cls}">${n > 0 ? `<span class="rm-count">${n}</span>` : '<span class="rm-count-0">0</span>'}${n > 0 ? `<span style="font-size:9px">${cls === 'critical' ? 'Çok Riskli' : cls === 'high' ? 'Riskli' : 'Orta'}</span>` : ''}</div>`;
  };
  document.getElementById('risk-matris').innerHTML = `
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px">Satır: Uygulama Durumu | Sütun: Kritiklik</div>
    <div class="risk-matris-grid">
      <div></div>
      <div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600;padding-bottom:4px">⚪ Düşük</div>
      <div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600;padding-bottom:4px">🟡 Orta</div>
      <div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600;padding-bottom:4px">🔴 Yüksek</div>
      <div class="rm-label">🟡 Kısmen</div>${cell('1-kismi','medium')}${cell('2-kismi','medium')}${cell('3-kismi','high')}
      <div class="rm-label">❌ Hayır</div>${cell('1-hayir','medium')}${cell('2-hayir','high')}${cell('3-hayir','critical')}
    </div>`;
}

function buildKritikBulgular() {
  const bulgular = SORULAR_100
    .filter(q => { const cv = STATE.cevaplar[q.id]; return cv && cv.c !== 'evet'; })
    .map(q => ({ q, cv: STATE.cevaplar[q.id], rd: riskDurumu(q, STATE.cevaplar[q.id].c) }))
    .sort((a, b) => (b.rd?.skor||0) - (a.rd?.skor||0))
    .slice(0, 10);
  document.getElementById('kritik-bulgular').innerHTML = bulgular.length
    ? bulgular.map(({ q, cv, rd }) => `
      <div class="kritik-bulgu-item">
        <span class="kb-badge ${rd?.label==='Çok Riskli'?'cr':'r'}">${rd?.label||'Riskli'}</span>
        <div>
          <div class="kb-text">${q.tedbir}</div>
          <div class="kb-sub">${shortCat(q.altKat)} • ${cv.c==='hayir'?'Uygulanmıyor':'Kısmen'} • ${q.tedbirNo}</div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--text2);font-size:13px">Henüz bulgu yok.</p>';
}

// ══════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ══════════════════════════════════════════════════════════════

function exportExcel() {
  if (typeof XLSX === 'undefined') { toast('SheetJS yüklenemedi', 'error'); return; }
  const wb = XLSX.utils.book_new();
  const tarih = new Date().toLocaleDateString('tr-TR');

  // ── SAYFA 1: ÖZET ──────────────────────────────────────────
  const all   = Object.values(STATE.cevaplar);
  const evet  = all.filter(v => v.c==='evet').length;
  const kismi = all.filter(v => v.c==='kismi').length;
  const hayir = all.filter(v => v.c==='hayir').length;
  const total = evet+kismi+hayir;
  const skor  = total > 0 ? Math.round(100*(evet+kismi*0.5)/total) : 0;

  const ws1_data = [
    ['BİLGİ GÜVENLİĞİ GAP ANALİZİ - YÖNETİM ÖZETİ'],
    ['Oluşturulma Tarihi', tarih],
    [],
    ['KAPSAM', 'DEĞER', 'AÇIKLAMA'],
    ['Yanıtlanan Kontrol', total, '100 kontrol üzerinden'],
    ['Genel Uyum Skoru', skor + '%', 'Ağırlıklı ortalama'],
    ['Tamamen Uyumlu', evet, 'Evet cevaplanan'],
    ['Kısmen Uyumlu', kismi, 'Kısmen cevaplanan'],
    ['Uyumsuz', hayir, 'Hayır cevaplanan'],
    ['Toplam Bulgu', kismi+hayir, 'Raporda yer alan'],
    [],
    ['1296 TEDBİR KAPSAMASI'],
    ['Cevaplanan Tedbir', Object.keys(STATE.cevaplar1296).length, '1296 tedbir üzerinden'],
    ['Uyumlu Tedbir', Object.values(STATE.cevaplar1296).filter(c=>c==='evet').length, ''],
    ['Kısmen Uyumlu', Object.values(STATE.cevaplar1296).filter(c=>c==='kismi').length, ''],
    ['Uyumsuz Tedbir', Object.values(STATE.cevaplar1296).filter(c=>c==='hayir').length, ''],
    [],
    ['KATEGORİ BAZLI UYUM'],
    ['Kategori', 'Uyumlu', 'Kısmen', 'Uyumsuz', 'Uyum %'],
    ...CATEGORIES.map(cat => {
      const qs = SORULAR_100.filter(q => q.anaKat===cat && STATE.cevaplar[q.id]);
      const e = qs.filter(q=>STATE.cevaplar[q.id].c==='evet').length;
      const k = qs.filter(q=>STATE.cevaplar[q.id].c==='kismi').length;
      const h = qs.filter(q=>STATE.cevaplar[q.id].c==='hayir').length;
      const n = qs.length;
      return [shortCat(cat), e, k, h, n>0 ? Math.round(100*(e+k*0.5)/n)+'%' : '—'];
    })
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(ws1_data);
  ws1['!cols'] = [{wch:35},{wch:15},{wch:40}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Özet');

  // ── SAYFA 2: BULGULAR (Hayır + Kısmen) ─────────────────────
  const ws2_data = [
    ['DANIŞMANLIK GÖRÜŞLERİ - BULGULAR'],
    ['Sıra', 'Tedbir No', 'Ana Kategori', 'Alt Kategori', 'Tedbir Adı', 'Cevap', 'Risk Durumu', 'Danışman Gözlemi / Tespit', 'AI Bulgu Metni', 'BİGR İyileştirme Önerisi', 'İlgili Mevzuat', 'ISO 27001:2022', 'ISO 27701:2019']
  ];
  let bulguSira = 1;
  SORULAR_100
    .filter(q => { const cv = STATE.cevaplar[q.id]; return cv && cv.c !== 'evet'; })
    .sort((a,b) => (riskDurumu(b,STATE.cevaplar[b.id].c)?.skor||0) - (riskDurumu(a,STATE.cevaplar[a.id].c)?.skor||0))
    .forEach(q => {
      const cv = STATE.cevaplar[q.id];
      const rd = riskDurumu(q, cv.c);
      ws2_data.push([
        bulguSira++, q.tedbirNo, q.anaKat, q.altKat, q.tedbir,
        cevapLabel(cv.c), rd?.label || '',
        cv.obs || '', cv.bulgu || '',
        q.oneri || '',
        lkp('mev', q.mev), lkp('iso1', q.iso1), lkp('iso2', q.iso2)
      ]);
    });
  const ws2 = XLSX.utils.aoa_to_sheet(ws2_data);
  ws2['!cols'] = [{wch:5},{wch:12},{wch:25},{wch:30},{wch:35},{wch:20},{wch:12},{wch:50},{wch:50},{wch:50},{wch:50},{wch:15},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Bulgular');

  // ── SAYFA 3: UYUMLULUK KANITLARI ───────────────────────────
  const ws3_data = [
    ['UYUMLULUK KANITLARI - TAMAMEN UYGULANIYORLAR'],
    ['Sıra', 'Tedbir No', 'Ana Kategori', 'Alt Kategori', 'Tedbir Adı', 'Kritiklik', 'Danışman Uygulama Notu', 'BİGR Tedbir Açıklaması', 'Kapsanan Tedbir Sayısı', 'ISO 27001:2022']
  ];
  let uyumluSira = 1;
  SORULAR_100
    .filter(q => STATE.cevaplar[q.id]?.c === 'evet')
    .forEach(q => {
      const cv = STATE.cevaplar[q.id];
      ws3_data.push([
        uyumluSira++, q.tedbirNo, q.anaKat, q.altKat, q.tedbir,
        q.kritiklik===3?'Yüksek':q.kritiklik===2?'Orta':'Düşük',
        cv.obs || '', q.oneri || '',
        q.kapsananSayi, lkp('iso1', q.iso1)
      ]);
    });
  const ws3 = XLSX.utils.aoa_to_sheet(ws3_data);
  ws3['!cols'] = [{wch:5},{wch:12},{wch:25},{wch:30},{wch:35},{wch:10},{wch:60},{wch:50},{wch:15},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Uyumluluk Kanıtları');

  // ── SAYFA 4: 1296 TEDBİR TAM LİSTE ────────────────────────
  const ws4_data = [
    ['1296 TEDBİR TAM LİSTESİ - OTOMATİK MAPPING'],
    ['#', 'Tedbir No', 'Ana Kategori', 'Alt Kategori', 'Tedbir Adı', 'Denetim Sorusu', 'Cevap', 'Uygulama Durumu', 'Kaynak (100. Soru)', 'Kritiklik', 'İlgili Mevzuat', 'ISO 27001:2022']
  ];
  SORULAR_1296.forEach((s, idx) => {
    const cv      = STATE.cevaplar1296[s.i] || '';
    const parentQ = SORULAR_100.find(q => q.id === s.p);
    ws4_data.push([
      idx+1, s.tn, s.ak, s.altk, s.ta, s.q,
      cv, cevapLabel(cv) || 'Cevapsız',
      parentQ ? `S${s.p}: ${parentQ.tedbir}` : `S${s.p}`,
      s.k===3?'Yüksek':s.k===2?'Orta':'Düşük',
      lkp('mev', s.mev), lkp('iso1', s.iso1)
    ]);
  });
  const ws4 = XLSX.utils.aoa_to_sheet(ws4_data);
  ws4['!cols'] = [{wch:5},{wch:12},{wch:25},{wch:30},{wch:35},{wch:60},{wch:8},{wch:25},{wch:50},{wch:10},{wch:50},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws4, '1296 Tedbir Listesi');

  // İndir
  const dosyaAdi = `BG-Gap-Analizi-${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, dosyaAdi);
  toast('✅ Excel raporu indirildi: ' + dosyaAdi, 'success');
}

// ══════════════════════════════════════════════════════════════
// API KEY / RESET / JSON EXPORT
// ══════════════════════════════════════════════════════════════

function showAPIKeyModal() {
  document.getElementById('api-modal').classList.add('visible');
  document.getElementById('api-key-input').value = localStorage.getItem(API_KEY_STOR) || '';
}
function saveAPIKey() {
  const k = document.getElementById('api-key-input').value.trim();
  if (!k) { toast('Boş olamaz', 'error'); return; }
  if (!k.startsWith('AIza') || k.length < 30) { toast('Geçersiz anahtar (AIza... ile başlamalı)', 'error'); return; }
  localStorage.setItem(API_KEY_STOR, k);
  closeAPIModal();
  toast('✅ API anahtarı kaydedildi', 'success');
}
function closeAPIModal() { document.getElementById('api-modal').classList.remove('visible'); }
function clearAPIKey() {
  if (!confirm('API anahtarını silmek istediğinize emin misiniz?')) return;
  localStorage.removeItem(API_KEY_STOR);
  document.getElementById('api-key-input').value = '';
  toast('API anahtarı silindi');
}

function resetAll() {
  if (!confirm('Tüm cevaplar ve bulgular silinecek. Emin misiniz?')) return;
  STATE.cevaplar = {};
  STATE.cevaplar1296 = {};
  STATE.page1296 = 0;
  localStorage.removeItem(STORAGE_KEY);
  buildSidebar();
  renderQuestion();
  updateStats();
  toast('✅ Sıfırlandı');
}

function exportData() {
  const d = { tarih: new Date().toISOString(), uygulama: 'BG Gap Analizi v4', cevaplar: STATE.cevaplar, cevaplar1296: STATE.cevaplar1296 };
  const b = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = `bg-gap-${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(u);
  toast('✅ JSON yedek indirildi');
}

// ── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();
  buildSidebar();
  renderQuestion();
  updateStats();
});
