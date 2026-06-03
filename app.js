// ══════════════════════════════════════════════════════════════
// Bilgi Güvenliği Gap Analizi v4 — Temiz Versiyon
// ══════════════════════════════════════════════════════════════

const STORAGE_KEY  = 'bg_gap_v4';
const API_KEY_STOR = 'bg_gemini_key';
const PUAN = { evet: 1, kismi: 0.5, hayir: 0 };
const PAGE_SIZE_1296 = 50;

// STATE nesnesine riskCache ekleyelim
const STATE = {
  projeAdi: "Yeni Proje",
  cevaplar: {},
  cevaplar1296: {},
  riskCache: {},
  currentIdx: 0,
  activeFilter: 'all',
  activePage: 'sorular',
  riskAnalizi: {},
  bulgu1296: {},   // {tedbir_i: {metin, kaynak}} — hibrit cache
  page1296: 0
};

const CATEGORIES = [...new Set(SORULAR_100.map(s => s.anaKat))];

// ── STORAGE ──────────────────────────────────────────────────
// save fonksiyonunu güncelleyelim
function save() {
  try {
    const toSave = {
      projeAdi:     STATE.projeAdi,
      cevaplar:     STATE.cevaplar,
      cevaplar1296: STATE.cevaplar1296,
      currentIdx:   STATE.currentIdx,
      activeFilter: STATE.activeFilter,
      activePage:   STATE.activePage,
      page1296:     STATE.page1296,
      riskAnalizi:  STATE.riskAnalizi,
      bulgu1296:   STATE.bulgu1296
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch(e) { console.warn('Save hatası:', e); }
}

// load fonksiyonunu güncelleyelim
function load() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (!r) return;
    const d = JSON.parse(r);
    STATE.projeAdi    = d.projeAdi    || 'Yeni Proje';
    STATE.cevaplar    = d.cevaplar    || {};
    STATE.cevaplar1296= d.cevaplar1296|| {};
    STATE.riskCache   = {};
    STATE.currentIdx  = d.currentIdx  || 0;
    STATE.activeFilter= d.activeFilter|| 'all';
    STATE.activePage  = d.activePage  || 'sorular';
    STATE.page1296    = d.page1296    || 0;
    STATE.riskAnalizi = d.riskAnalizi || {};
    STATE.bulgu1296  = d.bulgu1296  || {};
  } catch(e) { console.warn('Load hatası:', e); }
}


// ── UTILS ────────────────────────────────────────────────────
function shortCat(c) { return c.replace(/^\d+\.\d+\.\s*/, ''); }

function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast visible ' + type;
  setTimeout(() => t.classList.remove('visible'), 3000);
}

function critBadge(k) {
  if (k===3) return `<span class="badge badge-red">🔴 Yüksek</span>`;
  if (k===2) return `<span class="badge badge-amber">🟡 Orta</span>`;
  return `<span class="badge badge-gray">⚪ Düşük</span>`;
}

function lkp(type, id) {
  return (id >= 0 && LOOKUPS[type]) ? (LOOKUPS[type][id] || '') : '';
}

function cevapLabel(c) {
  return { evet:'Tamamen Uygulanıyor', kismi:'Kısmen Uygulanıyor', hayir:'Uygulanmıyor', kapsam:'Kapsam Dışı' }[c] || '—';
}

function riskDurumu(q, cevap) {
  const k = q.kritiklik;
  if (cevap === 'evet') return null;
  if (cevap === 'kapsam') return null;
  if (cevap === 'hayir') {
    if (k===3) return { label:'Çok Riskli', cls:'dk-risk-cok-riskli', skor:12 };
    if (k===2) return { label:'Riskli',     cls:'dk-risk-riskli',     skor:8  };
    return            { label:'Orta Riskli',cls:'dk-risk-orta',       skor:4  };
  }
  if (cevap === 'kismi') {
    if (k===3) return { label:'Riskli',     cls:'dk-risk-riskli', skor:6 };
    if (k===2) return { label:'Orta Riskli',cls:'dk-risk-orta',   skor:3 };
    return            { label:'Orta Riskli',cls:'dk-risk-orta',   skor:2 };
  }
  return null;
}

function propagate1296(q100, cevap) {
  SORULAR_1296.forEach(s => {
    if (s.p === q100.id) STATE.cevaplar1296[s.i] = cevap;
  });
}

// ── TABS ─────────────────────────────────────────────────────
function switchTab(name) {
  STATE.activePage = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  if (name === 'rapor')     renderRapor();
  if (name === 'uyumlu')    renderUyumlu();
  if (name === 'tedbirler') { initTedbirFilters(); render1296(); }
  if (name === 'ozet')      renderOzet();
}
// app.js


function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedState = JSON.parse(e.target.result);

      // Sadece bilinen alanları aktar (riskCache hariç)
      STATE.projeAdi    = importedState.projeAdi    || 'Yeni Proje';
      STATE.cevaplar    = importedState.cevaplar    || {};
      STATE.cevaplar1296= importedState.cevaplar1296|| {};
      STATE.riskCache   = {};
      STATE.currentIdx  = importedState.currentIdx  || 0;
      STATE.activeFilter= importedState.activeFilter|| 'all';
      STATE.activePage  = importedState.activePage  || 'sorular';
      STATE.page1296    = importedState.page1296    || 0;

      // Firma adını input'a yaz
      const projeInput = document.getElementById('proje-adi-input');
      if (projeInput) projeInput.value = STATE.projeAdi;

      save();
      buildSidebar();
      renderQuestion();
      updateStats();
      
      toast(`✅ "${STATE.projeAdi || 'Dosya'}" başarıyla yüklendi!`);
    } catch (err) {
      toast('❌ Dosya okunamadı, format hatalı!', 'error');
    }
  };
  reader.readAsText(file);
}
function updateProjeAdi(yeniIsim) {
  STATE.projeAdi = yeniIsim;
  STATE.tarih = new Date().toLocaleDateString();
  save();
  toast(`✅ Proje ismi "${yeniIsim}" olarak kaydedildi.`);
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
    const count    = SORULAR_100.filter(s => s.anaKat === c).length;
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
  return STATE.activeFilter === 'all'
    ? SORULAR_100
    : SORULAR_100.filter(s => s.anaKat === STATE.activeFilter);
}

function navigate(dir) {
  const list = filteredList();
  const pos  = list.findIndex(s => s === SORULAR_100[STATE.currentIdx]);
  const np   = pos + dir;

  // İleri giderken cevap kontrolü
  if (dir === 1) {
    const mevcutQ = SORULAR_100[STATE.currentIdx];
    if (!STATE.cevaplar[mevcutQ.id]) {
      toast('⚠️ Lütfen önce bu soruyu yanıtlayın', 'error');
      return;
    }
  }

  if (np >= 0 && np < list.length) {
    STATE.currentIdx = SORULAR_100.indexOf(list[np]);
    renderQuestion();
    save();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderQuestion() {
  try {
  const q   = SORULAR_100[STATE.currentIdx];
  const list = filteredList();
  const pos  = list.findIndex(s => s === q);

  document.getElementById('q-nav-info').textContent  = `Soru ${pos + 1} / ${list.length}`;
  document.getElementById('prev-btn').disabled        = pos <= 0;
  document.getElementById('next-btn').disabled        = pos >= list.length - 1;
  document.getElementById('q-section-label').textContent = q.altKat;

  const cv    = STATE.cevaplar[q.id] || null;
  const sel   = cv ? cv.c   : null;
  const obs   = cv ? (cv.obs   || '') : '';
  const bulgu = cv ? (cv.bulgu || '') : '';

  const mev  = lkp('mev',  q.mev);
  const iso1 = lkp('iso1', q.iso1);
  const iso2 = lkp('iso2', q.iso2);
  const iso3 = lkp('iso3', q.iso3);

  let refsHTML = '<div class="q-refs">';
  if (iso1) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 27001:2022</span><span class="ref-value">${iso1.replace(/\n/g,', ')}</span></span>`;
  if (iso2) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 27701:2019</span><span class="ref-value">${iso2.replace(/\n/g,', ')}</span></span>`;
  if (iso3) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 20000-1</span><span class="ref-value">${iso3.replace(/\n/g,', ')}</span></span>`;
  if (mev)  refsHTML += `<div class="ref-mev"><span class="ref-label">Mevzuat</span><span class="ref-mev-text">${mev}</span></div>`;
  refsHTML += '</div>';

  const borderColor = sel==='evet' ? 'rgba(16,185,129,0.3)' : sel==='kismi' ? 'rgba(245,158,11,0.3)' : sel==='kapsam' ? 'rgba(148,163,184,0.3)' : 'rgba(239,68,68,0.3)';
  const bgColor     = sel==='evet' ? 'rgba(16,185,129,0.06)' : sel==='kismi' ? 'rgba(245,158,11,0.06)' : sel==='kapsam' ? 'rgba(148,163,184,0.06)' : 'rgba(239,68,68,0.06)';
  const panelColor  = sel==='evet' ? '#10b981' : sel==='kismi' ? '#f59e0b' : sel==='kapsam' ? '#94a3b8' : '#f87171';
  const panelTitle  = sel==='evet'  ? '✅ Uygulama Notları'
                    : sel==='kismi' ? '🟡 Danışman Gözlemi'
                    : sel==='kapsam'? '⬜ Kapsam Dışı Notu'
                    : '❌ Tespit Notları';
  const panelDesc   = sel==='evet'  ? 'Kontrolün nasıl uygulandığını, kanıtları ve gözlemlerinizi yazın.'
                    : sel==='kismi' ? 'Mevcut durumu açıklayın. Bu metinden otomatik bulgu üretilecektir.'
                    : sel==='kapsam'? 'Bu kontrolün neden kapsam dışı olduğunu açıklayın.'
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
        <button class="ans ${sel==='evet'  ? 'sel-evet'  : ''}" onclick="setCevap('evet')">
          <span class="ans-icon">✅</span>
          <span class="ans-label">Evet</span>
          <span class="ans-desc">Tamamen uygulanıyor</span>
        </button>
        <button class="ans ${sel==='kismi' ? 'sel-kismi' : ''}" onclick="setCevap('kismi')">
          <span class="ans-icon">🟡</span>
          <span class="ans-label">Kısmen</span>
          <span class="ans-desc">Eksik veya kısmi uygulama</span>
        </button>
        <button class="ans ${sel==='hayir' ? 'sel-hayir' : ''}" onclick="setCevap('hayir')">
          <span class="ans-icon">❌</span>
          <span class="ans-label">Hayır</span>
          <span class="ans-desc">Uygulanmıyor</span>
        </button>
        <button class="ans ${sel==='kapsam' ? 'sel-kapsam' : ''}" onclick="setCevap('kapsam')">
          <span class="ans-icon">⬜</span>
          <span class="ans-label">Kapsam Dışı</span>
          <span class="ans-desc">Bu kontrol geçerli değil</span>
        </button>
      </div>
      ${sel ? `
      <div style="margin-top:1rem;padding:1.25rem;border-radius:10px;border:1px solid ${borderColor};background:${bgColor}">
        <div style="font-size:12px;font-weight:600;margin-bottom:5px;color:${panelColor}">${panelTitle}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:7px">${panelDesc}</div>
        <textarea id="kismi-obs"
          style="width:100%;min-height:85px;padding:9px;background:var(--bg);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:var(--text);font-size:13px;line-height:1.6;resize:vertical;font-family:inherit"
          placeholder="Gözlem notlarınızı buraya yazın...">${obs}</textarea>
        <div style="display:flex;gap:7px;margin-top:7px;justify-content:flex-end">
          ${(sel !== 'evet' && sel !== 'kapsam') ? `<button class="btn-ai" id="ai-gen-btn" onclick="bulguUret()" ${!obs.trim() ? 'disabled' : ''}>🤖 Bulgu Üret</button>` : ''}
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
  } catch(err) {
    console.error('renderQuestion hatası:', err);
    const qa = document.getElementById('q-area');
    if (qa) qa.innerHTML = '<div style="padding:2rem;color:#f87171">⚠️ Soru yüklenirken hata: ' + err.message + '</div>';
  }
}

// ── setCevap ─────────────────────────────────────────────────
function setCevap(val) {
  const q           = SORULAR_100[STATE.currentIdx];
  const mevcut      = STATE.cevaplar[q.id] || {};
  const oncekiCevap = mevcut.c || null;
  const obsTemizle  = oncekiCevap && oncekiCevap !== val;

  const otomatikNot = val === 'kapsam'
    ? `${q.tedbir} kontrolü kurumun mevcut yapısı ve faaliyet kapsamı itibarıyla bu denetim döneminde kapsam dışında değerlendirilmiştir.`
    : '';

  STATE.cevaplar[q.id] = {
    c:     val,
    obs:   obsTemizle ? otomatikNot : (mevcut.obs || otomatikNot),
    bulgu: obsTemizle ? '' : (val === 'evet' ? '' : (mevcut.bulgu || ''))
  };

  propagate1296(q, val);
  save();
  updateStats();
  buildSidebar();
  renderQuestion();
}

// ── bulguUret ─────────────────────────────────────────────────
async function bulguUret() {
  const q  = SORULAR_100[STATE.currentIdx];
  const ta = document.getElementById('kismi-obs');
  if (!ta || !ta.value.trim()) { toast('Gözlem metni boş olamaz', 'error'); return; }

  const apiKey = localStorage.getItem(API_KEY_STOR);
  if (!apiKey) { showAPIKeyModal(); return; }

  const obs  = ta.value.trim();
  const btn  = document.getElementById('ai-gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Üretiliyor...';

  const mev  = lkp('mev',  q.mev);
  const iso1 = lkp('iso1', q.iso1);

  const prompt = `Sen kıdemli bir BİGR ve KVKK baş denetçisisin. Aşağıdaki denetim kontrolü için danışman gözlemine dayalı profesyonel bulgu metni yaz.

KONTROL:
- Tedbir No: ${q.tedbirNo} | Tedbir: ${q.tedbir}
- Kategori: ${q.altKat} | Kritiklik: ${q.kritiklik===3?'Yüksek':q.kritiklik===2?'Orta':'Düşük'}
- Mevzuat: ${mev || 'BİGR Kapsamı'}
${iso1 ? "- ISO 27001:2022: " + iso1.replace(/\n/g,", ") : ""}
- BİGR Öneri: ${q.oneri || 'Standarda uygun uygulama'}

DANIŞMAN GÖZLEMI: "${obs}"

Türkçe, 3-4 cümle, resmi denetim üslubunda bulgu metni yaz. Sadece metni yaz, başlık veya açıklama ekleme.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
        })
      }
    );
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
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
  } catch(e) {
    toast('AI hatası: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🤖 Bulgu Üret';
  }
}

// ── updateStats ───────────────────────────────────────────────
function updateStats() {
  const all    = Object.values(STATE.cevaplar);
  // YENİ
const evet   = all.filter(v => v.c === 'evet').length;
const kismi  = all.filter(v => v.c === 'kismi').length;
const hayir  = all.filter(v => v.c === 'hayir').length;
const kapsam = all.filter(v => v.c === 'kapsam').length;
const total  = evet + kismi + hayir + kapsam;  // sayaca dahil
const skorBaz = evet + kismi + hayir;           // puana dahil değil
const skor   = skorBaz > 0 ? Math.round(100*(evet + kismi*0.5)/skorBaz) : null;
  const c1296  = Object.keys(STATE.cevaplar1296).length;

  document.getElementById('h-evet').textContent   = evet;
  document.getElementById('h-kismi').textContent  = kismi;
  document.getElementById('h-hayir').textContent  = hayir;
  document.getElementById('h-score').textContent  = skor !== null ? skor + '%' : '—';
  document.getElementById('prog').style.width     = Math.round(100*total/100) + '%';
  document.getElementById('badge-sorular').textContent   = total + '/100';
  document.getElementById('badge-rapor').textContent     = (hayir + kismi) + ' Bulgu';
  document.getElementById('badge-uyumlu').textContent    = evet;
  document.getElementById('badge-tedbirler').textContent = c1296 + '/1296';
}

// ══════════════════════════════════════════════════════════════
// SAYFA 2: BULGULAR
// ══════════════════════════════════════════════════════════════

function renderRapor() {
  const filter = document.getElementById('rapor-filter')?.value || 'all';
  let sorular = SORULAR_100.filter(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv || cv.c === 'evet' || cv.c === 'kapsam') return false;
    if (filter === 'hayir')     return cv.c === 'hayir';
    if (filter === 'kismi')     return cv.c === 'kismi';
    if (filter === 'cokriskli') return riskDurumu(q, cv.c)?.label === 'Çok Riskli';
    if (filter === 'riskli')    return riskDurumu(q, cv.c)?.label === 'Riskli';
    return true;
  });

  sorular.sort((a, b) =>
    (riskDurumu(b, STATE.cevaplar[b.id].c)?.skor || 0) -
    (riskDurumu(a, STATE.cevaplar[a.id].c)?.skor || 0)
  );

  const liste = document.getElementById('rapor-liste');
  const bos   = document.getElementById('rapor-bos');
  if (!sorular.length) { liste.innerHTML = ''; bos.style.display = 'block'; return; }
  bos.style.display = 'none';
  liste.innerHTML = sorular.map(q => buildDanismanKart(q)).join('');
}
function buildRiskKategorileriHTML(q, cv) {
  const k = q.kritiklik;
  const isHayir = cv.c === 'hayir';
  const ak = (q.anaKat || '').toLowerCase();
  const isKisiselVeri = ak.includes('kişisel');

  const s = (hayirBase, kismiBase) =>
    Math.min(10, isHayir ? hayirBase : kismiBase);

  const kategoriler = [
    {
      icon: '⚡', name: 'STRATEJİK', color: '#f87171',
      etki: s(k===3?9:k===2?7:5, k===3?7:k===2?5:3),
      olas: s(k===3?8:k===2?7:5, k===3?6:k===2?4:3),
      desc: isHayir
        ? `${q.tedbir} alanındaki kontrol eksikliği kurumun güvenlik stratejisini zayıflatmakta, üst yönetimin bilinçli risk kararları almasını engellemektedir.`
        : `${q.tedbir} alanındaki kısmi uygulama, stratejik güvenlik hedeflerinin tam karşılanamamasına yol açmaktadır.`
    },
    {
      icon: '🔧', name: 'OPERASYONEL', color: '#fb923c',
      etki: s(k===3?10:k===2?8:6, k===3?8:k===2?6:4),
      olas: s(k===3?9:k===2?8:6, k===3?7:k===2?5:4),
      desc: isHayir
        ? `Tedbirin uygulanmaması operasyonel süreçlerin güvenlik açıklarına karşı korumasız kalmasına ve iş sürekliliğinin tehlikeye girmesine neden olmaktadır.`
        : `Kısmi uygulama operasyonel etkinliği sınırlandırmakta; tam uyum sağlanana kadar süreçlerde güvenlik açığı devam etmektedir.`
    },
    {
      icon: '💰', name: 'FİNANSAL', color: '#fbbf24',
      etki: s(k===3?8:k===2?7:5, k===3?6:k===2?4:3),
      olas: s(k===3?7:k===2?6:4, k===3?5:k===2?4:3),
      desc: isKisiselVeri
        ? `KVKK kapsamında idari para cezası ve tazminat riski doğmakta; veri ihlali durumunda mali yükümlülükler önemli ölçüde artabilmektedir.`
        : isHayir
        ? `Olası güvenlik ihlali sonrasında olay müdahale, sistem kurtarma ve tazminat maliyetleri kurumun bütçesini ciddi biçimde etkileyebilir.`
        : `Eksikliğin giderilmemesi durumunda bütçelenmemiş güvenlik maliyetleri ve beklenmedik mali yükler gündeme gelebilir.`
    },
    {
      icon: '⚖️', name: 'MEVZUAT', color: '#60a5fa',
      etki: s(isKisiselVeri?10:k===3?8:k===2?7:5, isKisiselVeri?8:k===3?6:k===2?5:3),
      olas: s(isKisiselVeri?9:k===3?7:k===2?6:4, isKisiselVeri?7:k===3?5:k===2?4:3),
      desc: isKisiselVeri
        ? `KVKK'nın 12. maddesi kapsamında teknik ve idari tedbirlerin alınmaması, Kişisel Verileri Koruma Kurulu'nun idari yaptırım uygulamasına zemin hazırlamaktadır.`
        : `BİGR ${q.tedbirNo} numaralı tedbirin uygulanmaması ilgili mevzuat açısından uyumsuzluk riski doğurmakta ve denetim bulgusuna konu olabilmektedir.`
    },
    {
      icon: '📣', name: 'İTİBAR', color: '#a78bfa',
      etki: s(k===3?8:k===2?6:4, k===3?6:k===2?4:3),
      olas: s(k===3?7:k===2?6:4, k===3?5:k===2?4:3),
      desc: isKisiselVeri
        ? `Kişisel veri ihlali durumunda kurumun kamuoyu nezdindeki güvenilirliği zedelenebilir; müşteri ve iş ortağı ilişkileri olumsuz etkilenebilir.`
        : isHayir
        ? `Güvenlik açığının kamuoyuna yansıması veya bir ihlal yaşanması halinde kurumun sektördeki itibarı ve paydaş güveni ciddi biçimde sarsılabilir.`
        : `Eksikliğin devam etmesi durumunda yaşanabilecek güvenlik olayları kurumun itibarına kalıcı zarar verebilir.`
    }
  ];

  return kategoriler.map(cat => `
    <div style="margin-bottom:9px;padding:8px 10px;background:rgba(0,0,0,0.05);border-radius:6px;border-left:3px solid ${cat.color}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:10px;font-weight:700;color:${cat.color};letter-spacing:.5px">${cat.icon} ${cat.name}</span>
        <div style="display:flex;gap:4px">
<span style="font-size:9px;background:${cat.color};color:#fff;padding:2px 7px;border-radius:4px;font-weight:700;opacity:0.9">Etki ${cat.etki}</span>
          <span style="font-size:9px;background:rgba(0,0,0,0.15);color:#374151;padding:2px 7px;border-radius:4px;font-weight:700;border:1px solid rgba(0,0,0,0.1)">Olasılık ${cat.olas}</span>
        </div>
      </div>
      <div style="font-size:11px;color:#1a1a2e;line-height:1.5;font-weight:500">${cat.desc}</div>
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════════
// AI RİSK ANALİZİ
// ══════════════════════════════════════════════════════════════

async function aiRiskAnaliziUret(qId) {
  const q  = SORULAR_100.find(s => s.id === qId);
  const cv = STATE.cevaplar[qId];
  if (!q || !cv) return;

  // Cache kontrolü
  if (STATE.riskAnalizi[qId]) {
    document.getElementById(`risk-ai-box-${qId}`).innerHTML = renderRiskAIBox(qId);
    return;
  }

  const apiKey = localStorage.getItem(API_KEY_STOR);
  if (!apiKey) { showAPIKeyModal(); return; }

  const btn = document.getElementById(`risk-ai-btn-${qId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }

  const tespitMetni = cv.bulgu || cv.obs || `"${q.tedbir}" tedbiri uygulanmamaktadır.`;
  const mev  = lkp('mev',  q.mev);
  const iso1 = lkp('iso1', q.iso1);

  const prompt = `Sen kıdemli bir bilgi güvenliği danışmanısın. Aşağıdaki denetim bulgusuna göre yönetimin anlayacağı sade ve net dilde risk analizi yaz.

BULGU: "${tespitMetni}"
TEDBİR: ${q.tedbir} (${q.tedbirNo})
KATEGORİ: ${q.altKat}
KRİTİKLİK: ${q.kritiklik === 3 ? 'Yüksek' : q.kritiklik === 2 ? 'Orta' : 'Düşük'}
${mev ? 'MEVZUAT: ' + mev : ''}
${iso1 ? 'ISO 27001: ' + iso1.replace(/\n/g, ', ') : ''}

Aşağıdaki 4 risk kategorisi için birer paragraf yaz (her biri 1-2 cümle, teknik jargon kullanma, yönetim kuruluna hitap eden dil):

STRATEJİK RİSK:
OPERASYONELRİSK:
FİNANSAL RİSK:
İTİBAR RİSKİ:

Sadece bu 4 başlık ve içeriklerini yaz, başka açıklama ekleme.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
        })
      }
    );
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';

    STATE.riskAnalizi[qId] = text.trim();
    save();

    const box = document.getElementById(`risk-ai-box-${qId}`);
    if (box) box.innerHTML = renderRiskAIBox(qId);
    toast('✅ Risk analizi üretildi', 'success');
  } catch(e) {
    toast('AI hatası: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🤖 AI Risk Analizi'; }
  }
}

function renderRiskAIBox(qId) {
  const text = STATE.riskAnalizi[qId];
  if (!text) return '';

  // Metni kategorilere böl
  const kategoriler = [
    { key: 'STRATEJİK RİSK',   icon: '⚡', color: '#f87171' },
    { key: 'OPERASYONEL RİSK',  icon: '🔧', color: '#fb923c' },
    { key: 'FİNANSAL RİSK',    icon: '💰', color: '#fbbf24' },
    { key: 'İTİBAR RİSKİ',     icon: '📣', color: '#a78bfa' }
  ];

  let html = `<div style="margin-top:10px;border-top:1px solid rgba(0,0,0,0.1);padding-top:10px">
    <div style="font-size:9px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">
      🤖 AI Risk Değerlendirmesi
      <button onclick="clearRiskAnalizi(${qId})" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:9px;margin-left:8px;text-decoration:underline">Sil</button>
    </div>`;

  // Satırları parse et
  const lines = text.split('\n').filter(l => l.trim());
  let current = null;
  let currentText = [];
  const parsed = {};
  lines.forEach(line => {
    const match = kategoriler.find(k => line.toUpperCase().includes(k.key));
    if (match) {
      if (current && currentText.length) parsed[current] = currentText.join(' ').trim();
      current = match.key;
      currentText = [line.replace(/.*(?:RİSK[İ]?|RİSK):?\s*/i, '').trim()];
    } else if (current) {
      currentText.push(line.trim());
    }
  });
  if (current && currentText.length) parsed[current] = currentText.join(' ').trim();
  kategoriler.forEach(kat => {
    const icerik = parsed[kat.key] || text; // parse edilemezse ham metin
    html += `<div style="margin-bottom:7px;padding:8px 10px;background:rgba(0,0,0,0.04);border-radius:6px;border-left:3px solid ${kat.color}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:10px;font-weight:700;color:${kat.color}">${kat.icon} ${kat.key}</span>
      </div>
      <div style="font-size:11px;color:#1e293b;line-height:1.6;font-weight:500">${icerik}</div>
    </div>`;
  });

  html += '</div>';
  return html;
}

function clearRiskAnalizi(qId) {
  delete STATE.riskAnalizi[qId];
  save();
  const box = document.getElementById(`risk-ai-box-${qId}`);
  if (box) box.innerHTML = '';
  const btn = document.getElementById(`risk-ai-btn-${qId}`);
  if (btn) btn.innerHTML = '🤖 AI Risk Analizi';
}

function buildDanismanKart(q) {
  const cv  = STATE.cevaplar[q.id];
  const rd  = riskDurumu(q, cv.c);
  const mev = lkp('mev', q.mev);
  const iso1= lkp('iso1', q.iso1);
  const iso2= lkp('iso2', q.iso2);
  const iso3= lkp('iso3', q.iso3);

  // ── 1. KOLON: SAF TESPİTLER METNİ ──────────────────────────────
  let tespitMetni = '';
  if (cv.c === 'kismi' && cv.bulgu) {
    tespitMetni = cv.bulgu;
  } else if (cv.c === 'kismi' && cv.obs) {
    tespitMetni = `Denetim kapsamında "${q.tedbir}" alanında kısmi uygulama tespit edilmiştir. Danışman notu: ${cv.obs}`;
  } else if (cv.c === 'hayir') {
    // Tamamen saf tespit üslubu (Risk yorumları buraya karışmıyor)
    tespitMetni = `Yapılan saha incelemelerinde ve denetim mülakatlarında, "${q.tedbir}" kapsamındaki gerekliliklerin kurum bünyesinde uygulanmadığı tespit edilmiştir. ${q.altKat} alanına ilişkin tanımlı bir süreç, yürütülen bir kontrol mekanizması veya somut bir çalışma bulunmamaktadır. Bu durum, Bilgi ve İletişim Güvenliği Rehberi'nin (BİGR) ilgili maddelerine doğrudan uyumsuzluk teşkil etmektedir.`;
  } else {
    tespitMetni = `Kısmen uygulama durumu tespit edilmiştir. Detaylı gözlem notu eklenmemiştir.`;
  }

  // ── 2. KOLON: RİSK ANALİZİ (Tüm Risk Öğeleri Burada Toplanıyor) ──
  // Etki Skoru Hesaplama ve Açıklaması
  const etkiPuani = q.kritiklik * (cv.c === 'hayir' ? 4 : 3);
  const etkiselAciklama = cv.c === 'hayir'
    ? (q.kritiklik === 3 ? 'Tedbirin hiç uygulanmaması kuruma ciddi operasyonel, yasal ve itibar riski oluşturmaktadır. Güvenlik ihlali olasılığı yüksektir.'
     : q.kritiklik === 2 ? 'Tedbirin eksikliği, kurum varlıkları ve kişisel veriler üzerinde önemli risk yaratmaktadır.'
     : 'Orta düzey operasyonel risk söz konusudur.')
    : (q.kritiklik === 3 ? 'Kısmi uygulama, tam güvence sağlamamakta; kontrol etkinliği yetersiz kalmaktadır.'
     : 'Sürecin olgunlaşması için ek adım atılması gerekmektedir.');

  // Hukuki Risk ve Yaptırım Verisi
  let hukukiAks = mev ? mev : 'İlgili yasal mevzuat maddesi tanımlanmamıştır.';

  const isAI = cv.c === 'kismi' && cv.bulgu;

  // ── MEVZUAT KOLONU (3. KOLON) ──────────────────────────────────
  let mevzuatHTML = '';
  if (mev) {
    mevzuatHTML += `<div class="dk-mev-item">
  <div class="dk-mev-baslik">📜 İlgili Mevzuat</div>
  <div class="dk-mev-text">
    ${mev.split('\n').filter(s => s.trim()).map(s => 
      `<div style="display:flex;gap:6px;margin-bottom:5px">
        <span style="color:#92400e;font-weight:700;flex-shrink:0">•</span>
        <span>${s.trim()}</span>
      </div>`
    ).join('')}
  </div>
</div>`;
  }
  if (iso1 || iso2 || iso3) {
    mevzuatHTML += `<div class="dk-mev-item"><div class="dk-mev-baslik">🏷 Standart Referanslar</div><div>`;
    if (iso1) iso1.split('\n').filter(Boolean).forEach(v => {
      mevzuatHTML += `<span class="dk-mev-iso">ISO 27001:2022 ${v.trim()}</span>`;
    });
    if (iso2) iso2.split('\n').filter(Boolean).forEach(v => {
      mevzuatHTML += `<span class="dk-mev-iso">ISO 27701 ${v.trim()}</span>`;
    });
    if (iso3) iso3.split('\n').filter(Boolean).forEach(v => {
      mevzuatHTML += `<span class="dk-mev-iso">ISO 20000 ${v.trim()}</span>`;
    });
    mevzuatHTML += `</div></div>`;
  }
  if (!mevzuatHTML) {
    mevzuatHTML = `<div class="dk-mev-text" style="color:#9ca3af">BİGR ${q.tedbirNo} kapsamında değerlendirilmektedir.</div>`;
  }

  // ── ÖNERİ KOLONU (4. KOLON) ─────────────────────────────────────
const oneriLines = (q.oneri || '').split(/\n/).map(s => s.trim()).filter(s => s.length > 10);
  let oneriHTML = '';
  if (oneriLines.length > 0) {
    oneriLines.slice(0, 6).forEach((line, i) => {
      oneriHTML += `<div class="dk-oneri-item">
        <div class="dk-oneri-no">${i + 1}</div>
        <div class="dk-oneri-text">${line}</div>
      </div>`;
    });
  } else {
    oneriHTML = `<div class="dk-oneri-item">
      <div class="dk-oneri-no">1</div>
      <div class="dk-oneri-text">${q.oneri || 'Kontrol mekanizması oluşturularak dokümante edilmelidir.'}</div>
    </div>`;
  }

  return `
<div class="danisman-kart" id="kart-${q.id}">
  <div class="dk-header">
    <div class="dk-header-left">
      <div class="dk-ustbaslik">Danışmanlık Görüşü</div>
      <div class="dk-baslik">${q.altKat} — ${q.tedbir}</div>
    </div>
    <div class="dk-header-right">
      <span class="dk-risk-badge ${rd?.cls || 'dk-risk-orta'}">${rd?.label || 'Orta Riskli'}</span>
    </div>
  </div>

  <div class="dk-body">
  <div class="dk-kolon">
    <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">🔍</span> Tespitler</div>
    <div class="dk-tespit-text">${tespitMetni}</div>
  </div>

  <div class="dk-kolon">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <div class="dk-kolon-baslik" style="margin-bottom:0"><span class="dk-kolon-baslik-icon">⚠️</span> Risk Analizi</div>
    <span style="background:#92400e;color:#fef3c7;font-size:9px;font-weight:700;padding:3px 8px;border-radius:4px">KRİTİKLİK (${q.kritiklik * 4} PUAN)</span>
  </div>
    ${STATE.riskAnalizi[q.id] ? "" : buildRiskKategorileriHTML(q, cv)}
    
    <div style="margin-top:6px;padding:7px 10px;background:rgba(96,165,250,0.08);border-radius:6px;border-left:3px solid #60a5fa">
      <span class="dk-risk-label hukuki">Hukuki Risk</span>
      <div class="dk-risk-text" style="font-size:12px;line-height:1.5;color:#dc2626;font-weight:700">
  ⚠️ ${cv.c === 'hayir' ? 'Yüksek Uyumsuzluk Riski:' : 'Kısmi Uyumsuzluk Riski:'}
  <div style="margin-top:4px;font-weight:500;color:#1e3a5f;white-space:pre-line;font-size:11px">${hukukiAks}</div>
</div>
    </div>
    <div style="margin-top:8px">
      <button id="risk-ai-btn-${q.id}" onclick="aiRiskAnaliziUret(${q.id})"
        style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600;width:100%">
        ${STATE.riskAnalizi[q.id] ? '🔄 Yenile' : '🤖 AI Risk Analizi'}
      </button>
    </div>
    <div id="risk-ai-box-${q.id}">
      ${STATE.riskAnalizi[q.id] ? renderRiskAIBox(q.id) : ''}
    </div>
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
    <span class="dk-footer-no">${q.tedbirNo} • S${q.id} / 100 • Kapsam: ${q.kapsananSayi} Tedbir</span>
    <div style="display:flex;gap:8px;align-items:center">
      ${isAI ? '<span class="dk-ai-badge">🤖 AI Bulgu</span>' : ''}
      <span>${cv.c === 'hayir' ? '❌ Uygulanmıyor' : '🟡 Kısmen Uygulanıyor'}</span>
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
    if (filter === 'kapsam') return cv && cv.c === 'kapsam';
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

  const notlu = sorular.filter(q => STATE.cevaplar[q.id]?.obs?.trim()).length;
  const ozet = filter === 'kapsam'
    ? `${sorular.length} kapsam dışı kontrol`
    : `${sorular.length} uyumlu kontrol &nbsp;•&nbsp; ${notlu} tanesi uygulama notu içeriyor &nbsp;•&nbsp; ${sorular.reduce((s,q) => s+q.kapsananSayi, 0).toLocaleString('tr-TR')} tedbir kapsanıyor`;
  let html = `<div style="font-size:13px;color:var(--text2);margin-bottom:1.25rem">${ozet}</div>`;

  html += '<div style="display:flex;flex-direction:column;gap:1rem">';

  sorular.forEach(q => {
    const cv   = STATE.cevaplar[q.id];
    const obs  = (cv.obs || '').trim();

    // Kapsam dışı için ayrı kart
    if (filter === 'kapsam') {
      html += `
      <div style="background:var(--bg2);border:1px solid rgba(148,163,184,0.2);border-radius:10px;overflow:hidden;border-left:4px solid #94a3b8">
        <div style="padding:12px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px">⬜ Kapsam Dışı</div>
            <div style="font-size:14px;font-weight:700;color:var(--text)">${q.tedbir}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:3px">${q.altKat}</div>
          </div>
          <span style="font-size:10px;color:#94a3b8;background:rgba(148,163,184,0.1);padding:4px 10px;border-radius:12px;font-weight:600;font-family:monospace">${q.tedbirNo}</span>
        </div>
        ${obs ? `
        <div style="padding:10px 18px 14px;border-top:1px solid rgba(148,163,184,0.1)">
          <div style="font-size:10px;font-weight:600;color:#94a3b8;margin-bottom:5px">📝 Kapsam Dışı Gerekçesi</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.6">${obs}</div>
        </div>` : ''}
      </div>`;
      return;
    }
    const iso1 = lkp('iso1', q.iso1);
    const iso2 = lkp('iso2', q.iso2);
    const mev  = lkp('mev',  q.mev);
    const kritikRenk  = q.kritiklik===3 ? '#f87171' : q.kritiklik===2 ? '#fbbf24' : '#94a3b8';
    const kritikLabel = q.kritiklik===3 ? '🔴 Yüksek' : q.kritiklik===2 ? '🟡 Orta' : '⚪ Düşük';

    let isoHTML = '';
    if (iso1) iso1.split('\n').filter(Boolean).forEach(v => {
      isoHTML += `<span style="display:inline-flex;align-items:center;background:#0d1521;border:1px solid rgba(16,185,129,0.3);border-radius:4px;padding:2px 7px;font-size:10px;color:#34d399;font-weight:600;font-family:monospace;margin:2px 2px 0 0">ISO 27001:2022 ${v.trim()}</span>`;
    });
    if (iso2) iso2.split('\n').filter(Boolean).forEach(v => {
      isoHTML += `<span style="display:inline-flex;align-items:center;background:#0d1521;border:1px solid rgba(16,185,129,0.2);border-radius:4px;padding:2px 7px;font-size:10px;color:#6ee7b7;font-weight:600;font-family:monospace;margin:2px 2px 0 0">ISO 27701 ${v.trim()}</span>`;
    });

    html += `
    <div style="background:var(--bg2);border:1px solid rgba(16,185,129,0.2);border-radius:10px;overflow:hidden;border-left:4px solid var(--green)">
      <div style="background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(16,185,129,0.02));padding:12px 18px;border-bottom:1px solid rgba(16,185,129,0.12);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:10px;color:#34d399;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px">✅ Uyumlu Kontrol</div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${q.tedbir}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
          <span style="font-size:11px;color:${kritikRenk};background:rgba(0,0,0,0.2);padding:4px 10px;border-radius:12px;font-weight:600">${kritikLabel} Kritiklik</span>
          <span style="font-size:10px;color:#34d399;background:rgba(16,185,129,0.1);padding:4px 10px;border-radius:12px;font-weight:600;font-family:monospace">${q.tedbirNo}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:${obs ? '1fr 1fr' : '1fr'};gap:0">
        <div style="padding:14px 18px;${obs ? 'border-right:1px solid rgba(16,185,129,0.1)' : ''}">
          <div style="font-size:10px;font-weight:600;color:#34d399;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">📋 Kapsam & Referanslar</div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:8px">${shortCat(q.altKat)}</div>
          ${isoHTML ? `<div style="margin-bottom:8px">${isoHTML}</div>` : ''}
          ${mev ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;line-height:1.5;padding:7px 10px;background:var(--bg3);border-radius:6px">${mev}</div>` : ''}
          <div style="margin-top:10px"><span style="font-size:11px;color:#34d399">📊 ${q.kapsananSayi} tedbiri kapsıyor</span></div>
        </div>
        ${obs ? `
        <div style="padding:14px 18px;background:rgba(16,185,129,0.03)">
          <div style="font-size:10px;font-weight:600;color:#34d399;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">📝 Danışman Uygulama Notu</div>
          <div style="font-size:13px;color:var(--text);line-height:1.65;white-space:pre-line">${obs}</div>
        </div>` : ''}
      </div>
      <div style="background:rgba(16,185,129,0.04);border-top:1px solid rgba(16,185,129,0.1);padding:7px 18px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:10px;color:var(--text3);font-family:monospace">${q.tedbirNo} • S${q.id}/100</span>
        <span style="font-size:11px;color:#34d399;font-weight:600">✅ Tamamen Uygulanıyor</span>
      </div>
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
    if (cevap === 'bos'   && cv)             return false;
    if (search && !(
      s.q?.toLowerCase().includes(search) ||
      s.ta?.toLowerCase().includes(search) ||
      s.tn?.toLowerCase().includes(search)
    )) return false;
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

  const allC = Object.values(STATE.cevaplar1296);
  const st = {
    evet:   allC.filter(c=>c==='evet').length,
    kismi:  allC.filter(c=>c==='kismi').length,
    hayir:  allC.filter(c=>c==='hayir').length,
    kapsam: allC.filter(c=>c==='kapsam').length,
    bos:    SORULAR_1296.length - allC.length
  };
  document.getElementById('t-stats').innerHTML = `
    <div class="t-stats-kart"><div class="val" style="color:var(--green)">${st.evet}</div><div class="lbl">Uyumlu</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--amber)">${st.kismi}</div><div class="lbl">Kısmen</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--red)">${st.hayir}</div><div class="lbl">Uyumsuz</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--gray)">${st.kapsam}</div><div class="lbl">Kapsam Dışı</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--gray)">${st.bos}</div><div class="lbl">Cevapsız</div></div>
    <div class="t-stats-kart"><div class="val" style="color:var(--teal)">${SORULAR_1296.length - st.bos}</div><div class="lbl">Cevaplanan</div></div>`;

  const wrap = document.querySelector('.t-tablo-wrap');

  if (!slice.length) {
    if (wrap) wrap.innerHTML = `<div style="padding:3rem;text-align:center;color:var(--text2)">Bu filtrelere uygun tedbir bulunamadı.</div>`;
    document.getElementById('t-pagination').innerHTML = '';
    return;
  }

  const rowStyle = {
    evet:   { bg:'rgba(16,185,129,0.04)', left:'#10b981' },
    kismi:  { bg:'rgba(245,158,11,0.04)', left:'#f59e0b' },
    hayir:  { bg:'rgba(239,68,68,0.05)',  left:'#ef4444' },
    kapsam: { bg:'rgba(148,163,184,0.04)',left:'#94a3b8' },
    bos:    { bg:'transparent',           left:'#334155' }
  };
  const cevapRenk = {
    evet:   { bg:'rgba(16,185,129,0.15)', color:'#34d399', label:'✅ Uyumlu'      },
    kismi:  { bg:'rgba(245,158,11,0.15)', color:'#fbbf24', label:'🟡 Kısmen'      },
    hayir:  { bg:'rgba(239,68,68,0.15)',  color:'#f87171', label:'❌ Uyumsuz'     },
    kapsam: { bg:'rgba(148,163,184,0.15)',color:'#94a3b8', label:'⬜ Kapsam Dışı' },
    bos:    { bg:'rgba(100,116,139,0.15)',color:'#94a3b8', label:'— Cevapsız'    }
  };

  const groups = {};
  slice.forEach(s => { if (!groups[s.ak]) groups[s.ak]=[]; groups[s.ak].push(s); });

  let html = '<div style="display:flex;flex-direction:column;gap:1.25rem">';

  Object.entries(groups).forEach(([anaKat, items]) => {
    const cE = items.filter(s=>STATE.cevaplar1296[s.i]==='evet').length;
    const cK = items.filter(s=>STATE.cevaplar1296[s.i]==='kismi').length;
    const cH = items.filter(s=>STATE.cevaplar1296[s.i]==='hayir').length;
    const cB = items.filter(s=>!STATE.cevaplar1296[s.i]).length;
    const n  = items.length;
    const skor = n > cB ? Math.round(100*(cE+cK*0.5)/(n-cB)) : 0;
    const skorRenk = skor>=70?'#10b981':skor>=40?'#f59e0b':skor>0?'#ef4444':'#475569';

    html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="background:linear-gradient(135deg,var(--bg3),var(--bg2));padding:12px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${shortCat(anaKat)}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--green)">✅ ${cE}</span>
          <span style="font-size:11px;color:var(--amber)">🟡 ${cK}</span>
          <span style="font-size:11px;color:#f87171">❌ ${cH}</span>
          <span style="font-size:11px;color:var(--gray)">— ${cB}</span>
          <span style="font-size:12px;font-weight:700;color:${skorRenk};background:rgba(0,0,0,0.2);padding:3px 10px;border-radius:12px">%${skor} Uyum</span>
          <span style="font-size:11px;color:var(--text3)">${n} tedbir</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column">`;

    items.forEach((s, idx) => {
      const cv  = STATE.cevaplar1296[s.i] || 'bos';
      const rs  = rowStyle[cv];
      const cr  = cevapRenk[cv];
      const parentQ    = SORULAR_100.find(q => q.id === s.p);
      const altKatKisa = s.altk.replace(/^\d+\.\d+\.\d+\.\s*/,'').replace(/^\d+\.\d+\.\s*/,'');
      const bgHover    = cv==='bos' ? 'rgba(255,255,255,0.02)' : rs.bg.replace('0.04','0.08').replace('0.05','0.09');

      // Cache'den oku, yoksa şablon üret
      const cached1296 = STATE.bulgu1296[s.i];
      const sablonKismi = `🟡 <strong>${s.ta}</strong> kapsamında kısmi uygulama tespit edilmiştir.${parentQ?.obs ? ' ' + parentQ.obs + '.' : ''} Söz konusu tedbirin eksiksiz uygulanabilmesi için gerekli süreç ve kontrol mekanizmalarının oluşturulması gerekmektedir.`;
      const sablonHayir = `❌ Yapılan incelemede <strong>${s.ta}</strong> kapsamındaki gereklilikler kurumda uygulanmamaktadır. ${altKatKisa} alanında tanımlı bir süreç veya kontrol mekanizması bulunmamaktadır. Bu durum BİGR rehberinin ${s.tn} numaralı tedbir maddesine doğrudan aykırılık teşkil etmektedir.`;

      const bulguMetni = cv === 'evet'
        ? `✅ <strong>${s.ta}</strong> tedbiri kurumda uygulanmaktadır.`
        : cached1296
        ? (cached1296.kaynak === 'ai' ? `🤖 ${cached1296.metin}` : cached1296.metin)
        : cv === 'hayir' ? sablonHayir
        : cv === 'kismi' ? sablonKismi
        : '';

      const bulguKaynak = cached1296?.kaynak || (cv === 'kismi' || cv === 'hayir' ? 'sablon' : '');

      html += `<div style="border-bottom:${idx<items.length-1?'1px solid rgba(255,255,255,0.04)':'none'}">
        <div style="display:grid;grid-template-columns:90px 160px 180px 1fr 130px 50px;gap:0;background:${rs.bg};border-left:3px solid ${rs.left};cursor:${cv!=='bos'?'pointer':'default'}"
          onmouseover="this.style.background='${bgHover}'"
          onmouseout="this.style.background='${rs.bg}'"
          ${cv !== 'bos' ? `onclick="const b=document.getElementById('b1296-${s.i}');if(b){b.style.display=b.style.display==='block'?'none':'block'}"` : ''}>
          <div style="padding:10px 12px;display:flex;align-items:center"><span style="font-size:10px;font-family:monospace;color:var(--teal);font-weight:600">${s.tn}</span></div>
          <div style="padding:10px 8px;display:flex;align-items:center"><span style="font-size:10px;color:var(--text3);line-height:1.35">${altKatKisa}</span></div>
          <div style="padding:10px 8px;display:flex;align-items:center"><span style="font-size:11px;color:var(--text2);font-weight:500;line-height:1.4">${s.ta}</span></div>
          <div style="padding:10px 12px;display:flex;align-items:center"><span style="font-size:12px;color:var(--text);line-height:1.5">${s.q}</span></div>
          <div style="padding:10px 8px;display:flex;align-items:center;justify-content:center">
            <span style="display:inline-block;background:${cr.bg};color:${cr.color};font-size:11px;font-weight:600;padding:4px 10px;border-radius:12px;text-align:center;white-space:nowrap">${cr.label}</span>
          </div>
          <div style="padding:10px 8px;display:flex;align-items:center;justify-content:center" title="${parentQ ? parentQ.tedbir : ''}">
            <span style="font-size:10px;color:var(--teal);font-family:monospace;font-weight:600;background:var(--teal-soft);padding:3px 7px;border-radius:8px">S${s.p}</span>
          </div>
        </div>
        ${cv !== 'bos' ? `
        <div id="b1296-${s.i}" style="display:none;padding:10px 16px 12px 16px;background:rgba(255,255,255,0.03);border-left:3px solid ${rs.left}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            ${bulguKaynak === 'ai' ? '<span style="font-size:9px;background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 7px;border-radius:4px;font-weight:600">🤖 AI Bulgu</span>' : bulguKaynak === 'sablon' ? '<span style="font-size:9px;background:rgba(148,163,184,0.15);color:#94a3b8;padding:2px 7px;border-radius:4px;font-weight:600">📋 Şablon</span>' : ''}
            ${(cv === 'kismi' || cv === 'hayir') && !cached1296 ? `<span style="font-size:9px;color:#6366f1;cursor:pointer;text-decoration:underline" onclick="event.stopPropagation();tekBulguUret(${s.i})">🤖 AI ile yenile</span>` : ''}
          </div>
          <div style="font-size:11px;color:#cbd5e1;line-height:1.75">${bulguMetni}</div>
        </div>` : ''}
      </div>`;
    });

    html += `</div></div>`;
  });

  html += '</div>';
  if (wrap) wrap.innerHTML = html;

  const totalPages = Math.ceil(total / PAGE_SIZE_1296);
  let pgHtml = '';
  if (totalPages > 1) {
    if (page > 0) pgHtml += `<button class="pg-btn" onclick="goPage1296(${page-1})">← Önceki</button>`;
    const pArr = totalPages <= 7
      ? Array.from({length:totalPages},(_,i)=>i)
      : [0,...(page>2?['...']:[]),...Array.from({length:3},(_,i)=>Math.min(Math.max(page-1+i,1),totalPages-2)).filter((v,i,a)=>a.indexOf(v)===i),...(page<totalPages-3?['...']:[]),totalPages-1];
    pArr.forEach(p => {
      if (p==='...') pgHtml += `<span style="padding:6px 4px;color:var(--text3)">…</span>`;
      else pgHtml += `<button class="pg-btn ${p===page?'active':''}" onclick="goPage1296(${p})">${p+1}</button>`;
    });
    if (page < totalPages-1) pgHtml += `<button class="pg-btn" onclick="goPage1296(${page+1})">Sonraki →</button>`;
    pgHtml += `<span style="font-size:12px;color:var(--text2);margin-left:8px">${start+1}–${Math.min(start+PAGE_SIZE_1296,total)} / ${total}</span>`;
  }
  const pgEl = document.getElementById('t-pagination');
  pgEl.innerHTML = pgHtml;
  pgEl.style.display = totalPages > 1 ? 'flex' : 'none';
}


// ══════════════════════════════════════════════════════════════
// 1296 HİBRİT BULGU SİSTEMİ
// ══════════════════════════════════════════════════════════════

function sablonBulgu1296(s, parentQ) {
  const cv = STATE.cevaplar1296[s.i];
  const altKatKisa = s.altk.replace(/^\d+\.\d+\.\d+\.\s*/,'').replace(/^\d+\.\d+\.\s*/,'');
  if (cv === 'kismi') {
    return `${s.ta} kapsamında kısmi uygulama tespit edilmiştir.${parentQ?.obs ? ' ' + parentQ.obs + '.' : ''} Söz konusu tedbirin eksiksiz uygulanabilmesi için gerekli süreç ve kontrol mekanizmalarının oluşturulması gerekmektedir.`;
  }
  if (cv === 'hayir') {
    return `Yapılan incelemede ${s.ta} kapsamındaki gereklilikler kurumda uygulanmamaktadır. ${altKatKisa} alanında tanımlı bir süreç veya kontrol mekanizması bulunmamaktadır. Bu durum BİGR rehberinin ${s.tn} numaralı tedbir maddesine doğrudan aykırılık teşkil etmektedir.`;
  }
  return '';
}

async function tekBulguUret(tedbirIdx) {
  const s = SORULAR_1296.find(x => x.i === tedbirIdx);
  if (!s) return;
  const parentQ = SORULAR_100.find(q => q.id === s.p);
  const cv = STATE.cevaplar1296[s.i];
  if (!cv || cv === 'evet' || cv === 'bos') return;

  const apiKey = localStorage.getItem(API_KEY_STOR);
  if (!apiKey) {
    // API yoksa şablon kullan
    STATE.bulgu1296[s.i] = { metin: sablonBulgu1296(s, parentQ), kaynak: 'sablon' };
    save();
    render1296();
    return;
  }

  const obs = parentQ?.obs || '';
  const parentOneri = (parentQ?.oneri || '').substring(0, 200);

  const prompt = `Sen kıdemli bir BİGR baş denetçisisin. Aşağıdaki tedbire özgü denetim bulgusu yaz.

TEDBİR: ${s.ta} (${s.tn})
DENETİM SORUSU: ${s.q}
UYGULAMA DURUMU: ${cv === 'kismi' ? 'Kısmen uygulanıyor' : 'Uygulanmıyor'}${obs ? '\nDANIŞMAN GÖZLEMI: ' + obs : ''}${parentOneri ? '\nBİGR ÖNERİSİ: ' + parentOneri : ''}

Kurallar:
- Tam olarak 2 cümle yaz
- Resmi denetim üslubu kullan
- Bu tedbire özgü, spesifik bir bulgu olsun
- Genel kalıplar ve tekrar eden ifadeler kullanma
- Sadece bulgu metnini yaz, başlık veya açıklama ekleme`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.3,maxOutputTokens:200} }) }
    );
    if (!resp.ok) throw new Error(`${resp.status}`);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '';
    if (text.trim()) {
      STATE.bulgu1296[s.i] = { metin: text.trim(), kaynak: 'ai' };
    } else {
      throw new Error('boş');
    }
  } catch(e) {
    STATE.bulgu1296[s.i] = { metin: sablonBulgu1296(s, parentQ), kaynak: 'sablon' };
  }
  save();
  render1296();
}

// Batch: 5'li gruplar halinde API isteği
async function batchBulguUret(tedbirListesi, apiKey) {
  if (!tedbirListesi.length) return;

  const items = tedbirListesi.map((s, idx) => {
    const parentQ = SORULAR_100.find(q => q.id === s.p);
    const cv = STATE.cevaplar1296[s.i];
    const obs = parentQ?.obs || '';
    const oneri = (parentQ?.oneri || '').substring(0, 150);
    return '[' + (idx+1) + '] Tedbir: ' + s.ta + ' (' + s.tn + ') | Soru: ' + s.q +
      ' | Durum: ' + (cv === 'kismi' ? 'Kısmen' : 'Uygulanmıyor') +
      (obs ? ' | Gözlem: ' + obs : '') +
      (oneri ? ' | Öneri: ' + oneri : '');
  });

  const satir = '\n';
  const prompt = 'Sen kıdemli bir BİGR baş denetçisisin. Aşağıdaki ' + tedbirListesi.length +
    ' tedbir için ayrı ayrı özgün denetim bulgusu yaz.' + satir + satir +
    items.join(satir + satir) +
    satir + satir + 'Her tedbir için:' + satir + '[1] İki cümlelik özgün bulgu.' + satir +
    '[2] İki cümlelik özgün bulgu.' + satir + satir +
    'Kurallar: Her bulgu 2 cümle, tedbire özel, farklı içerik, resmi üslup. Sadece numaralı bulguları yaz.';

  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + encodeURIComponent(apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: tedbirListesi.length * 150 }
        })
      }
    );
    if (!resp.ok) throw new Error(resp.status);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';

    // Parse: [1] metin [2] metin ...
    tedbirListesi.forEach((s, idx) => {
      const num = idx + 1;
      const next = idx + 2;
      // Daha güvenli split yaklaşımı
      const parts = text.split(new RegExp('\[' + next + '\]'));
      const myPart = parts[0];
      const myMatch = myPart.match(new RegExp('\[' + num + '\]([\s\S]+)'));
      if (myMatch && myMatch[1].trim()) {
        STATE.bulgu1296[s.i] = { metin: myMatch[1].trim(), kaynak: 'ai' };
      } else if (!STATE.bulgu1296[s.i]) {
        const parentQ = SORULAR_100.find(q => q.id === s.p);
        STATE.bulgu1296[s.i] = { metin: sablonBulgu1296(s, parentQ), kaynak: 'sablon' };
      }
    });
    return true;
  } catch(e) {
    tedbirListesi.forEach(s => {
      if (!STATE.bulgu1296[s.i]) {
        const parentQ = SORULAR_100.find(q => q.id === s.p);
        STATE.bulgu1296[s.i] = { metin: sablonBulgu1296(s, parentQ), kaynak: 'sablon' };
      }
    });
    return false;
  }
}

async function tumKismenleriBulguUret() {
  const apiKey = localStorage.getItem(API_KEY_STOR);
  const BATCH_SIZE = 5;

  const kismenler = SORULAR_1296.filter(s =>
  STATE.cevaplar1296[s.i] === 'kismi'
);
  if (!kismenler.length) { toast('Kısmen veya Hayır cevaplı tedbir yok', 'error'); return; }

  const bekleyenler = kismenler.filter(s =>
    !STATE.bulgu1296[s.i] || STATE.bulgu1296[s.i].kaynak === 'sablon'
  );
  const toplam = bekleyenler.length;
  if (toplam === 0) { toast('Tüm AI bulgular zaten üretilmiş ✅', 'success'); return; }

  const btn = document.getElementById('btn-toplu-bulgu');
  let tamamlanan = 0, aiSayac = 0, sablonSayac = 0;

  const guncelle = () => {
    if (btn) btn.textContent = `⏳ ${tamamlanan}/${toplam} üretiliyor...`;
  };
  if (btn) { btn.disabled = true; guncelle(); }

  if (!apiKey) {
    bekleyenler.forEach(s => {
      if (!STATE.bulgu1296[s.i]) {
        const parentQ = SORULAR_100.find(q => q.id === s.p);
        STATE.bulgu1296[s.i] = { metin: sablonBulgu1296(s, parentQ), kaynak: 'sablon' };
        sablonSayac++;
      }
    });
    save(); render1296();
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Toplu Bulgu Üret'; }
    toast('✅ ' + sablonSayac + ' şablon bulgu üretildi', 'success');
    return;
  }

  for (let i = 0; i < bekleyenler.length; i += BATCH_SIZE) {
    const grup = bekleyenler.slice(i, i + BATCH_SIZE);
    const oncekiAi = Object.values(STATE.bulgu1296).filter(b => b.kaynak === 'ai').length;

    await batchBulguUret(grup, apiKey);

    const yeniAi = Object.values(STATE.bulgu1296).filter(b => b.kaynak === 'ai').length;
    aiSayac += yeniAi - oncekiAi;
    sablonSayac += grup.length - (yeniAi - oncekiAi);
    tamamlanan += grup.length;
    guncelle();
    save();

    if (i + BATCH_SIZE < bekleyenler.length) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  render1296();
  if (btn) { btn.disabled = false; btn.textContent = '🤖 Toplu Bulgu Üret'; }
  toast(`✅ ${aiSayac} AI + ${sablonSayac} şablon bulgu üretildi`, 'success');
}

function bulgu1296Temizle() {
  if (!confirm('Tüm 1296 tedbir bulgularını temizlemek istiyor musunuz?')) return;
  STATE.bulgu1296 = {};
  save();
  render1296();
  toast('✅ 1296 bulgular temizlendi');
}

function goPage1296(p) {
  STATE.page1296 = p;
  render1296();
}

// ══════════════════════════════════════════════════════════════
// SAYFA 5: YÖNETİM ÖZETİ
// ══════════════════════════════════════════════════════════════

let pieChart = null, barChart = null;

function renderOzet() {
  document.getElementById('ozet-tarih').textContent =
    new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' }) + ' tarihi itibarıyla';

  const all    = Object.values(STATE.cevaplar);
  const evet   = all.filter(v=>v.c==='evet').length;
  const kismi  = all.filter(v=>v.c==='kismi').length;
  const hayir  = all.filter(v=>v.c==='hayir').length;
  const total  = evet+kismi+hayir;
  const skor   = total > 0 ? Math.round(100*(evet+kismi*0.5)/total) : 0;
  const kapQ   = SORULAR_100.filter(q => STATE.cevaplar[q.id]);

  document.getElementById('ozet-grid').innerHTML = `
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--teal)">${skor}%</div><div class="ozet-kart-lbl">Genel Uyum Skoru</div><div class="ozet-kart-sub">${total}/100 yanıtlandı</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--green)">${evet}</div><div class="ozet-kart-lbl">Uyumlu</div><div class="ozet-kart-sub">${kapQ.filter(q=>STATE.cevaplar[q.id].c==='evet').reduce((s,q)=>s+q.kapsananSayi,0)} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--amber)">${kismi}</div><div class="ozet-kart-lbl">Kısmen</div><div class="ozet-kart-sub">${kapQ.filter(q=>STATE.cevaplar[q.id].c==='kismi').reduce((s,q)=>s+q.kapsananSayi,0)} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--red)">${hayir}</div><div class="ozet-kart-lbl">Uyumsuz</div><div class="ozet-kart-sub">${kapQ.filter(q=>STATE.cevaplar[q.id].c==='hayir').reduce((s,q)=>s+q.kapsananSayi,0)} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--purple)">${kismi+hayir}</div><div class="ozet-kart-lbl">Toplam Bulgu</div><div class="ozet-kart-sub">Raporda yer alan</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--teal)">${Object.keys(STATE.cevaplar1296).length}</div><div class="ozet-kart-lbl">1296 Tedbir</div><div class="ozet-kart-sub">Cevaplanan</div></div>`;

  buildPie(evet, kismi, hayir);
  buildBar();
  buildRiskMatris();
  buildKritikBulgular();
}

function buildPie(e, k, h) {
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('chart-pie'), {
    type: 'doughnut',
    data: { labels:['Uyumlu','Kısmen','Uyumsuz'], datasets:[{ data:[e,k,h], backgroundColor:['#10b981','#f59e0b','#ef4444'], borderWidth:0 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:'#94a3b8', font:{size:11}, padding:10, usePointStyle:true } } } }
  });
}

function buildBar() {
  const labels = CATEGORIES.map(c => shortCat(c).substring(0,25));
  const data   = CATEGORIES.map(cat => {
    const qs = SORULAR_100.filter(q => q.anaKat===cat && STATE.cevaplar[q.id]);
    if (!qs.length) return 0;
    return Math.round(100 * qs.reduce((s,q) => s+(PUAN[STATE.cevaplar[q.id].c]||0), 0) / qs.length);
  });
  const colors = data.map(d => d>=70?'#10b981':d>=40?'#f59e0b':d>0?'#ef4444':'#475569');
  const h = Math.max(300, CATEGORIES.length*32+60);
  document.getElementById('chart-bar-wrap').style.height = h+'px';
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('chart-bar'), {
    type:'bar',
    data:{ labels, datasets:[{ data, backgroundColor:colors, borderRadius:4 }] },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ beginAtZero:true, max:100, ticks:{ color:'#94a3b8', callback:v=>v+'%' }, grid:{ color:'rgba(255,255,255,0.05)' } },
        y:{ ticks:{ color:'#94a3b8', font:{size:10} }, grid:{ display:false } }
      },
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:c=>` Uyum: %${c.raw}` } } }
    }
  });
}

function buildRiskMatris() {
  // ── Veri toplama ─────────────────────────────────────────
  const m = { '3-hayir':0,'3-kismi':0,'2-hayir':0,'2-kismi':0,'1-hayir':0,'1-kismi':0 };
  SORULAR_100.forEach(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv || cv.c === 'evet' || cv.c === 'kapsam') return;
    const key = `${q.kritiklik}-${cv.c}`;
    if (key in m) m[key]++;
  });

  // ── Zon renkleri ─────────────────────────────────────────
  const zone3 = (s) => {
    if (s <= 3) return { bg:'rgba(16,185,129,0.15)', b:'#10B981', t:'#10B981', l:'Düşük Risk'  };
    if (s <= 6) return { bg:'rgba(245,158,11,0.18)', b:'#F59E0B', t:'#F59E0B', l:'Orta Risk'   };
    return             { bg:'rgba(220,38,38,0.25)',  b:'#DC2626', t:'#DC2626', l:'Yüksek Risk' };
  };
  const zone5 = (s) => {
    if (s <= 4)  return { bg:'rgba(16,185,129,0.15)', b:'#10B981', t:'#10B981', l:'Kabul Edilebilir'  };
    if (s <= 9)  return { bg:'rgba(245,158,11,0.18)', b:'#F59E0B', t:'#F59E0B', l:'Tolere Edilebilir' };
    if (s <= 14) return { bg:'rgba(234,88,12,0.22)',  b:'#EA580C', t:'#EA580C', l:'Önemli'            };
    return              { bg:'rgba(220,38,38,0.25)',  b:'#DC2626', t:'#DC2626', l:'Kabul Edilemez'    };
  };

  // ── Veri eşleme ───────────────────────────────────────────
  // 3x3: Olas 1=düşük(0 soru), 2=orta(kısmen), 3=yüksek(hayır)
  const n3 = (etki, olas) => {
    if (olas === 2) return m[`${etki}-kismi`];
    if (olas === 3) return m[`${etki}-hayir`];
    return 0;
  };
  // 5x5: Kritiklik 1→Etki2, 2→Etki3, 3→Etki5 | Kısmen→Olas3, Hayır→Olas5
  const n5 = (etki, olas) => {
    const ek = {2:1, 3:2, 5:3}[etki];
    const ok = {3:'kismi', 5:'hayir'}[olas];
    return (ek && ok) ? (m[`${ek}-${ok}`] || 0) : 0;
  };

  // ── Hücre oluşturucu ──────────────────────────────────────
  const cell = (skor, n, z, small) => `
    <div style="background:${z.bg};border:1px solid ${z.b};border-radius:5px;
      padding:${small?'5px 2px':'7px 3px'};text-align:center;
      min-height:${small?'50px':'60px'};
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;">
      <div style="font-size:${small?'14px':'18px'};font-weight:800;color:${z.t};line-height:1">${skor}</div>
      <div style="font-size:7px;font-weight:700;color:${z.t};opacity:.85">${z.l}</div>
      ${n > 0 ? `<div style="background:rgba(0,0,0,0.2);color:${z.t};font-size:7px;font-weight:700;
        padding:1px 5px;border-radius:6px;margin-top:2px">${n} kontrol</div>` : ''}
    </div>`;

   // ── Okuma rehberleri ──────────────────────────────────────
  const guide3 = `
    <div style="margin-top:10px;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,0.03);
      border-radius:7px;border-left:3px solid #10B981;font-size:9px;color:var(--text2);line-height:1.8">
      <div style="font-size:10px;font-weight:700;color:var(--text);margin-bottom:4px">📖 Nasıl Okunur?</div>
      <b>Dikey eksen (Etki):</b> Kontrolün kritikliği — BİGR rehberindeki ağırlık.<br>
      <b>Yatay eksen (Olasılık):</b> Denetim cevabı — Düşük: uygulanıyor, Orta: kısmen, Yüksek: uygulanmıyor.<br>
      <b>Hücredeki büyük sayı</b> risk skorudur (Etki × Olasılık). Maksimum 9.<br>
      <b>Küçük rozet</b> o hücreye düşen gerçek kontrol adedini gösterir.<br>
      <span style="color:#10B981">■</span> 1–3 Düşük Risk &nbsp;
      <span style="color:#F59E0B">■</span> 4–6 Orta Risk &nbsp;
      <span style="color:#DC2626">■</span> 7–9 Yüksek Risk
    </div>`;

  const guide5 = `
    <div style="margin-top:10px;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,0.03);
      border-radius:7px;border-left:3px solid #6366f1;font-size:9px;color:var(--text2);line-height:1.8">
      <div style="font-size:10px;font-weight:700;color:var(--text);margin-bottom:4px">📖 Nasıl Okunur?</div>
      <b>ISO 31000 standardı</b> 5 seviyeli Etki × Olasılık matrisini öngörür. Maksimum skor 25.<br>
      <span style="color:#10B981">■</span> 1–4 Kabul Edilebilir &nbsp;
      <span style="color:#F59E0B">■</span> 5–9 Tolere Edilebilir &nbsp;
      <span style="color:#EA580C">■</span> 10–14 Önemli &nbsp;
      <span style="color:#DC2626">■</span> 15–25 Kabul Edilemez
    </div>`;
  // ── 3×3 matris ───────────────────────────────────────────
  const mat3 = () => {
    const rLbl = [[3,'🔴 Yüksek','#f87171'],[2,'🟡 Orta','#fbbf24'],[1,'🟢 Düşük','#34d399']];
    const cLbl = ['DÜŞÜK (×1)','ORTA (×2)','YÜKSEK (×3)'];
    let g = `<div style="display:grid;grid-template-columns:60px 1fr 1fr 1fr;gap:4px;align-items:center">`;
    g += `<div style="font-size:7px;color:var(--text3);text-align:center;line-height:1.4">ETKİ ↓<br>OLAS. →</div>`;
    cLbl.forEach(l => g += `<div style="text-align:center;font-size:8px;font-weight:700;
      color:var(--text2);padding:3px;background:rgba(255,255,255,0.04);border-radius:3px">${l}</div>`);
    rLbl.forEach(([etki, lbl, color]) => {
      g += `<div style="font-size:8px;font-weight:700;color:${color};text-align:right;padding-right:5px">${lbl}</div>`;
      [1,2,3].forEach(olas => g += cell(etki*olas, n3(etki,olas), zone3(etki*olas), false));
    });
    return g + `</div>`;
  };

  
  // ── 5×5 matris ───────────────────────────────────────────
  const mat5 = () => {
    const rLbl = [
      [5,'Kritik (5)','#f87171'],
      [4,'Yüksek (4)','#fb923c'],
      [3,'Orta (3)',  '#fbbf24'],
      [2,'Düşük (2)', '#34d399'],
      [1,'Çok Düşük (1)','#94a3b8'],
    ];
    const cLbl = ['ÇOK DÜŞÜK','DÜŞÜK','ORTA','YÜKSEK','ÇOK YÜKSEK'];
    let g = `<div style="display:grid;grid-template-columns:70px 1fr 1fr 1fr 1fr 1fr;gap:3px;align-items:center">`;
    g += `<div style="font-size:7px;color:var(--text3);text-align:center;line-height:1.4">ETKİ ↓<br>OLAS. →</div>`;
    cLbl.forEach(l => g += `<div style="text-align:center;font-size:7px;font-weight:700;
      color:var(--text2);padding:2px;background:rgba(255,255,255,0.04);border-radius:3px">${l}</div>`);
    rLbl.forEach(([etki, lbl, color]) => {
      g += `<div style="font-size:7px;font-weight:700;color:${color};text-align:right;padding-right:4px;line-height:1.3">${lbl}</div>`;
      [1,2,3,4,5].forEach(olas => g += cell(etki*olas, n5(etki,olas), zone5(etki*olas), true));
    });
    return g + `</div>`;
  };

 

  document.getElementById('risk-matris').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px">
          📋 BİGR Rehberi — 3×3 Risk Matrisi
        </div>
        ${guide3}
        ${mat3()}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px">
          🌐 ISO 31000 Uyarlaması — 5×5 Risk Matrisi
        </div>
        ${guide5}
        ${mat5()}
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:5px;background:rgba(16,185,129,0.12);
            border:1px solid #10B981;border-radius:6px;padding:4px 10px">
            <div style="width:8px;height:8px;border-radius:50%;background:#10B981"></div>
            <span style="font-size:9px;font-weight:700;color:#10B981">1–4 Kabul Edilebilir</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;background:rgba(245,158,11,0.12);
            border:1px solid #F59E0B;border-radius:6px;padding:4px 10px">
            <div style="width:8px;height:8px;border-radius:50%;background:#F59E0B"></div>
            <span style="font-size:9px;font-weight:700;color:#F59E0B">5–9 Tolere Edilebilir</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;background:rgba(234,88,12,0.12);
            border:1px solid #EA580C;border-radius:6px;padding:4px 10px">
            <div style="width:8px;height:8px;border-radius:50%;background:#EA580C"></div>
            <span style="font-size:9px;font-weight:700;color:#EA580C">10–14 Önemli</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;background:rgba(220,38,38,0.12);
            border:1px solid #DC2626;border-radius:6px;padding:4px 10px">
            <div style="width:8px;height:8px;border-radius:50%;background:#DC2626"></div>
            <span style="font-size:9px;font-weight:700;color:#DC2626">15–25 Kabul Edilemez</span>
          </div>
        </div>
      </div>
    </div>`;
}

function buildKritikBulgular() {
  const bulgular = SORULAR_100
    .filter(q => { const cv=STATE.cevaplar[q.id]; return cv && cv.c!=='evet'; })
    .map(q => ({ q, cv:STATE.cevaplar[q.id], rd:riskDurumu(q,STATE.cevaplar[q.id].c) }))
    .sort((a,b) => (b.rd?.skor||0)-(a.rd?.skor||0))
    .slice(0,10);
  document.getElementById('kritik-bulgular').innerHTML = bulgular.length
    ? bulgular.map(({q,cv,rd}) => `
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
  const firmaAdi = STATE.projeAdi || 'Kurum Adı';
  const all = Object.values(STATE.cevaplar);
  const evet  = all.filter(v => v.c === 'evet').length;
  const kismi = all.filter(v => v.c === 'kismi').length;
  const hayir = all.filter(v => v.c === 'hayir').length;
  const kapsam= all.filter(v => v.c === 'kapsam').length;
  const skorBaz = evet + kismi + hayir;
  const skor = skorBaz > 0 ? Math.round(100*(evet+kismi*0.5)/skorBaz) : 0;

  // ── YARDIMCI FONKSİYONLAR ──────────────────────────────
  function C(v, font, bgRGB, align, border) {
    const c = { v, t: typeof v === 'number' ? 'n' : 's' };
    const s = {};
    if (font)   s.font = font;
    if (bgRGB)  s.fill = { patternType: 'solid', fgColor: { rgb: bgRGB } };
    if (align)  s.alignment = align;
    if (border) s.border = border;
    if (Object.keys(s).length) c.s = s;
    return c;
  }
  const BOŞ = (bg) => C('', null, bg, null, null);
  const ORTA = { horizontal: 'center', vertical: 'center', wrapText: true };
  const SOL  = { horizontal: 'left',   vertical: 'center', wrapText: true };
  const SAĞ  = { horizontal: 'right',  vertical: 'center', wrapText: true };

  // Border tanımları
  const B_İNCE = {
    top:    { style:'thin',   color:{rgb:'CBD5E1'} },
    bottom: { style:'thin',   color:{rgb:'CBD5E1'} },
    left:   { style:'thin',   color:{rgb:'CBD5E1'} },
    right:  { style:'thin',   color:{rgb:'CBD5E1'} }
  };
  const B_ALTIN = {
    top:    { style:'medium', color:{rgb:'D4AF4A'} },
    bottom: { style:'medium', color:{rgb:'D4AF4A'} },
    left:   { style:'medium', color:{rgb:'D4AF4A'} },
    right:  { style:'medium', color:{rgb:'D4AF4A'} }
  };
  const B_KOYU = {
    top:    { style:'medium', color:{rgb:'1A3A5C'} },
    bottom: { style:'medium', color:{rgb:'1A3A5C'} },
    left:   { style:'medium', color:{rgb:'1A3A5C'} },
    right:  { style:'medium', color:{rgb:'1A3A5C'} }
  };
  const B_YESIL = {
    top:    { style:'medium', color:{rgb:'059669'} },
    bottom: { style:'medium', color:{rgb:'059669'} },
    left:   { style:'medium', color:{rgb:'059669'} },
    right:  { style:'medium', color:{rgb:'059669'} }
  };

  // Renk sabitleri
  const KOY = '0D1B2E'; // en koyu lacivert
  const LAC = '1A2D44'; // lacivert
  const ORT = '243B55'; // orta lacivert
  const ACK = 'EFF4FB'; // açık mavi-gri
  const BYZ = 'FFFFFF';
  const ALT = 'D4AF4A'; // altın
  const AL2 = 'F5E49C'; // açık altın
  const YSL = '059669'; // koyu yeşil
  const YSA = 'D1FAE5'; // açık yeşil
  const SAR = 'D97706'; // koyu sarı
  const SAA = 'FEF3C7'; // açık sarı
  const KIR = 'DC2626'; // koyu kırmızı
  const KIA = 'FEE2E2'; // açık kırmızı
  const MOR = '7C3AED'; // mor
  const MOA = 'EDE9FE'; // açık mor
  const GRI = '64748B'; // gri
  const GRA = 'F1F5F9'; // açık gri

  // Font tanımları
  const F = {
    baslik:   { name:'Calibri', sz:22, bold:true,  color:{rgb:ALT} },
    altbaslik:{ name:'Calibri', sz:12, bold:true,  color:{rgb:BYZ} },
    beyazB:   { name:'Calibri', sz:11, bold:true,  color:{rgb:BYZ} },
    altinB:   { name:'Calibri', sz:11, bold:true,  color:{rgb:ALT} },
    koyuB:    { name:'Calibri', sz:11, bold:true,  color:{rgb:KOY} },
    normal:   { name:'Calibri', sz:10,              color:{rgb:'1E293B'} },
    kucuk:    { name:'Calibri', sz:9,               color:{rgb:GRI} },
    yesilB:   { name:'Calibri', sz:10, bold:true,  color:{rgb:YSL} },
    sariB:    { name:'Calibri', sz:10, bold:true,  color:{rgb:SAR} },
    kirmizB:  { name:'Calibri', sz:10, bold:true,  color:{rgb:KIR} },
    morB:     { name:'Calibri', sz:10, bold:true,  color:{rgb:MOR} },
    griN:     { name:'Calibri', sz:10,              color:{rgb:GRI} },
    mono:     { name:'Courier New', sz:9, bold:true,color:{rgb:'1E293B'} },
  };

  function set(ws, col, row, cell) {
    ws[XLSX.utils.encode_cell({ c: col, r: row })] = cell;
  }
  function satir(ws, row, cols, cells) {
    cols.forEach((col, i) => { if(cells[i]) set(ws, col, row, cells[i]); });
  }
  function blokDoldur(ws, r, c1, c2, bg) {
    for (let c = c1; c <= c2; c++) set(ws, c, r, BOŞ(bg));
  }

  // ══════════════════════════════════════════════════════════
  // SAYFA 1 — YÖNETİM ÖZETİ
  // ══════════════════════════════════════════════════════════
  const ws1 = {}; let R = 0;
  const S1 = (c,r,cell) => set(ws1,c,r,cell);
  const NCOL = 8; // toplam sütun

  // ── Başlık bandı (3 satır, tam genişlik)
  S1(0,R, C('BİLGİ GÜVENLİĞİ GAP ANALİZİ', F.baslik, KOY, ORTA, B_ALTIN));
  blokDoldur(ws1, R, 1, NCOL-1, KOY); R++;

  S1(0,R, C(firmaAdi.toUpperCase() + ' — UYUMLULUK DEĞERLENDİRME RAPORU', F.altbaslik, LAC, ORTA, null));
  blokDoldur(ws1, R, 1, NCOL-1, LAC); R++;

  S1(0,R, C('Rapor Tarihi: ' + tarih + '   |   BİGR & KVKK Kapsamı   |   ' + (evet+kismi+hayir+kapsam) + '/100 Kontrol', { name:'Calibri',sz:10,italic:true,color:{rgb:AL2} }, ORT, ORTA, null));
  blokDoldur(ws1, R, 1, NCOL-1, ORT); R += 2;

  // ── Uyum skoru büyük kart
  const skBg = skor>=70 ? YSA : skor>=40 ? SAA : KIA;
  const skFg = skor>=70 ? YSL : skor>=40 ? SAR : KIR;
  const skLabel = skor>=70 ? '✅  UYUMLU SEVİYE' : skor>=40 ? '⚠️  GELİŞTİRİLEBİLİR' : '❌  KRİTİK SEVİYE';

  // Sol: skor kutusu (4 sütun)
  S1(0,R, C('GENEL UYUM SKORU', {name:'Calibri',sz:11,bold:true,color:{rgb:'475569'}}, ACK, ORTA, B_KOYU));
  blokDoldur(ws1, R, 1, 3, ACK);
  // Sağ: durum etiketi (4 sütun)
  S1(4,R, C(skLabel, {name:'Calibri',sz:12,bold:true,color:{rgb:skFg}}, skBg, ORTA, B_KOYU));
  blokDoldur(ws1, R, 5, NCOL-1, skBg); R++;

  S1(0,R, C(skor+'%', {name:'Calibri',sz:36,bold:true,color:{rgb:skFg}}, skBg, ORTA, B_KOYU));
  blokDoldur(ws1, R, 1, 3, skBg);
  S1(4,R, C(skorBaz+'/100 kontrol yanıtlandı', {name:'Calibri',sz:13,bold:true,color:{rgb:skFg}}, skBg, ORTA, B_KOYU));
  blokDoldur(ws1, R, 5, NCOL-1, skBg); R++;

  S1(0,R, C('Ağırlıklı ortalama (Evet=1, Kısmen=0.5)', {name:'Calibri',sz:9,italic:true,color:{rgb:GRI}}, ACK, ORTA, B_KOYU));
  blokDoldur(ws1, R, 1, 3, ACK);
  S1(4,R, C('Firma: ' + firmaAdi, {name:'Calibri',sz:10,color:{rgb:'475569'}}, skBg, ORTA, B_KOYU));
  blokDoldur(ws1, R, 5, NCOL-1, skBg); R += 2;

  // ── 5 metrik kart (tek satır)
  const kartlar = [
    { lbl:'✅ UYUMLU',       val:evet,      alt:evet+' kontrol',    bg:YSA, fg:YSL, bg2:YSA },
    { lbl:'🟡 KISMİ',        val:kismi,     alt:kismi+' kontrol',   bg:SAA, fg:SAR, bg2:SAA },
    { lbl:'❌ UYUMSUZ',      val:hayir,     alt:hayir+' kontrol',   bg:KIA, fg:KIR, bg2:KIA },
    { lbl:'⬜ KAPSAM DIŞI',  val:kapsam,    alt:kapsam+' kontrol',  bg:GRA, fg:GRI, bg2:GRA },
    { lbl:'📋 TOPLAM BULGU', val:kismi+hayir, alt:'Hayır + Kısmen', bg:MOA, fg:MOR, bg2:MOA },
  ];

  // 5 kart × 8 sütun = ~1.6 sütun per kart — 2'şer sütun kullanalım
  // Başlık satırı
  const kartCols = [0,2,4,6,8]; // 10 sütun olacak
  kartlar.forEach((k,i) => {
    const c = i * 2;
    S1(c,R, C(k.lbl, {name:'Calibri',sz:10,bold:true,color:{rgb:k.fg}}, k.bg, ORTA, B_İNCE));
    S1(c+1,R, BOŞ(k.bg));
  }); R++;
  kartlar.forEach((k,i) => {
    const c = i * 2;
    S1(c,R, C(k.val, {name:'Calibri',sz:28,bold:true,color:{rgb:k.fg}}, k.bg2, ORTA, B_İNCE));
    S1(c+1,R, BOŞ(k.bg2));
  }); R++;
  kartlar.forEach((k,i) => {
    const c = i * 2;
    S1(c,R, C(k.alt, {name:'Calibri',sz:9,color:{rgb:GRI}}, k.bg, ORTA, B_İNCE));
    S1(c+1,R, BOŞ(k.bg));
  }); R += 2;

  // ── Kategori tablosu
  S1(0,R, C('KATEGORİ ANALİZİ', F.altbaslik, LAC, SOL, null));
  blokDoldur(ws1, R, 1, 9, LAC); R++;

  const katHdr = ['KATEGORİ','UYUMLU','KISMİ','UYUMSUZ','KAPSAM DIŞI','TOPLAM','UYUM %','DURUM','TEDBİR SAYISI'];
  katHdr.forEach((h,i) => {
    S1(i,R, C(h, F.beyazB, KOY, ORTA, B_İNCE));
  }); R++;

  CATEGORIES.forEach((cat, idx) => {
    const qs = SORULAR_100.filter(q => q.anaKat===cat);
    const ce = qs.filter(q=>STATE.cevaplar[q.id]?.c==='evet').length;
    const ck = qs.filter(q=>STATE.cevaplar[q.id]?.c==='kismi').length;
    const ch = qs.filter(q=>STATE.cevaplar[q.id]?.c==='hayir').length;
    const cc = qs.filter(q=>STATE.cevaplar[q.id]?.c==='kapsam').length;
    const ct = qs.filter(q=>STATE.cevaplar[q.id]).length;
    const cs = ct>0 ? Math.round(100*(ce+ck*0.5)/ct) : 0;
    const rf = idx%2===0 ? ACK : BYZ;
    const sf = cs>=70?YSA:cs>=40?SAA:cs>0?KIA:GRA;
    const sfont = cs>=70?F.yesilB:cs>=40?F.sariB:cs>0?F.kirmizB:F.griN;
    const durum = cs>=70?'✅ İyi':cs>=40?'⚠️ Dikkat':cs>0?'❌ Kritik':'— Değerlendirilmedi';
    const tSay = qs.reduce((s,q)=>s+(q.kapsananSayi||0),0);

    S1(0,R, C(shortCat(cat), F.normal, rf, SOL, B_İNCE));
    S1(1,R, C(ce, {name:'Calibri',sz:10,bold:true,color:{rgb:YSL}}, rf, ORTA, B_İNCE));
    S1(2,R, C(ck, {name:'Calibri',sz:10,bold:true,color:{rgb:SAR}}, rf, ORTA, B_İNCE));
    S1(3,R, C(ch, {name:'Calibri',sz:10,bold:true,color:{rgb:KIR}}, rf, ORTA, B_İNCE));
    S1(4,R, C(cc, F.griN, rf, ORTA, B_İNCE));
    S1(5,R, C(ct, F.normal, rf, ORTA, B_İNCE));
    S1(6,R, C(cs+'%', sfont, sf, ORTA, B_İNCE));
    S1(7,R, C(durum, sfont, sf, ORTA, B_İNCE));
    S1(8,R, C(tSay, F.kucuk, rf, ORTA, B_İNCE));
    R++;
  });

  ws1['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:R+2,c:9}});
  ws1['!merges'] = [
    {s:{r:0,c:0},e:{r:0,c:9}},{s:{r:1,c:0},e:{r:1,c:9}},{s:{r:2,c:0},e:{r:2,c:9}},
    {s:{r:4,c:0},e:{r:4,c:3}},{s:{r:4,c:4},e:{r:4,c:9}},
    {s:{r:5,c:0},e:{r:5,c:3}},{s:{r:5,c:4},e:{r:5,c:9}},
    {s:{r:6,c:0},e:{r:6,c:3}},{s:{r:6,c:4},e:{r:6,c:9}},
  ];
  ws1['!cols'] = [{wch:30},{wch:9},{wch:9},{wch:9},{wch:12},{wch:9},{wch:9},{wch:18},{wch:14}];
  ws1['!rows'] = [{hpt:40},{hpt:22},{hpt:16},{hpt:8},{hpt:22},{hpt:38},{hpt:16}];
  XLSX.utils.book_append_sheet(wb, ws1, '📊 Yönetim Özeti');

  // ══════════════════════════════════════════════════════════
  // SAYFA 2 — BULGULAR RAPORU
  // ══════════════════════════════════════════════════════════
  const ws2 = {}; let R2 = 0;
  const S2 = (c,r,cell) => set(ws2,c,r,cell);

  S2(0,R2, C('BULGULAR VE TESPİTLER RAPORU', {name:'Calibri',sz:22,bold:true,color:{rgb:'FCA5A5'}}, KIR, ORTA, B_ALTIN));
  for(let c=1;c<=8;c++) S2(c,R2,BOŞ(KIR)); R2++;
  S2(0,R2, C(firmaAdi+' | '+tarih+' | Toplam '+(kismi+hayir)+' Bulgu', F.altbaslik, LAC, ORTA, null));
  for(let c=1;c<=8;c++) S2(c,R2,BOŞ(LAC)); R2++;
  // Risk renk açıklaması
  S2(0,R2, C('🔴 Çok Riskli', {name:'Calibri',sz:9,bold:true,color:{rgb:KIR}}, KIA, ORTA, B_İNCE));
  S2(1,R2, C('🟡 Riskli', {name:'Calibri',sz:9,bold:true,color:{rgb:SAR}}, SAA, ORTA, B_İNCE));
  S2(2,R2, C('🟣 Orta Riskli', {name:'Calibri',sz:9,bold:true,color:{rgb:MOR}}, MOA, ORTA, B_İNCE));
  for(let c=3;c<=8;c++) S2(c,R2,BOŞ(GRA));
  R2 += 2;

  const B2hdr = ['#','Tedbir No','Alt Kategori','Kontrol Adı','Cevap','Risk Seviyesi','Tespit / Bulgu Metni','Danışman Gözlemi','İyileştirme Önerisi'];
  const B2bg = ['3B1215','3B1215','3B1215','3B1215','3B1215','3B1215','3B1215','3B1215','3B1215'];
  B2hdr.forEach((h,i) => {
    S2(i,R2, C(h, {name:'Calibri',sz:10,bold:true,color:{rgb:'FECACA'}}, '3B1215', ORTA, B_İNCE));
  }); R2++;

  const bulgular = SORULAR_100
    .filter(q => { const cv=STATE.cevaplar[q.id]; return cv&&(cv.c==='hayir'||cv.c==='kismi'); })
    .sort((a,b) => (riskDurumu(b,STATE.cevaplar[b.id].c)?.skor||0)-(riskDurumu(a,STATE.cevaplar[a.id].c)?.skor||0));

  bulgular.forEach((q,i) => {
    const cv = STATE.cevaplar[q.id];
    const rd = riskDurumu(q, cv.c);
    const rfBg  = rd?.label==='Çok Riskli'?KIA : rd?.label==='Riskli'?SAA : MOA;
    const rfFont= rd?.label==='Çok Riskli'?F.kirmizB : rd?.label==='Riskli'?F.sariB : F.morB;
    const sepBg = rd?.label==='Çok Riskli'?'FECACA' : rd?.label==='Riskli'?'FDE68A' : 'DDD6FE';

    const tespit = cv.bulgu || (cv.c==='hayir'
      ? '"'+q.tedbir+'" kapsamındaki gereklilikler uygulanmamaktadır.'
      : '"'+q.tedbir+'" alanında kısmi uygulama tespit edilmiştir.');
    const oneri = (q.oneri||'').split('\n').filter(Boolean)[0] || '—';
    const cevapLabel = cv.c==='hayir'?'❌ Hayır':'🟡 Kısmen';

    // Sol kenar renk şeridi için border
    const leftBorder = {
      top:   B_İNCE.top, bottom: B_İNCE.bottom, right: B_İNCE.right,
      left:  { style:'thick', color:{rgb: rd?.label==='Çok Riskli'?KIR:rd?.label==='Riskli'?SAR:MOR} }
    };

    S2(0,R2, C(i+1, F.kucuk, rfBg, ORTA, leftBorder));
    S2(1,R2, C(q.tedbirNo, F.mono, rfBg, ORTA, B_İNCE));
    S2(2,R2, C(shortCat(q.altKat), F.kucuk, rfBg, SOL, B_İNCE));
    S2(3,R2, C(q.tedbir, {name:'Calibri',sz:10,bold:true,color:{rgb:'0F172A'}}, rfBg, SOL, B_İNCE));
    S2(4,R2, C(cevapLabel, rfFont, rfBg, ORTA, B_İNCE));
    S2(5,R2, C(rd?.label||'Orta Riskli', rfFont, {fgColor:{rgb:sepBg}}&&rfBg, ORTA, B_İNCE));
    S2(6,R2, C(tespit, F.normal, rfBg, SOL, B_İNCE));
    S2(7,R2, C(cv.obs||'—', {name:'Calibri',sz:10,italic:true,color:{rgb:'475569'}}, rfBg, SOL, B_İNCE));
    S2(8,R2, C(oneri, {name:'Calibri',sz:10,color:{rgb:'1E40AF'}}, rfBg, SOL, B_İNCE));
    R2++;
  });

  ws2['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:R2,c:8}});
  ws2['!merges'] = [{s:{r:0,c:0},e:{r:0,c:8}},{s:{r:1,c:0},e:{r:1,c:8}}];
  ws2['!cols'] = [{wch:5},{wch:13},{wch:22},{wch:28},{wch:12},{wch:14},{wch:55},{wch:40},{wch:45}];
  XLSX.utils.book_append_sheet(wb, ws2, '📑 Bulgular');

  // ══════════════════════════════════════════════════════════
  // SAYFA 3 — UYUMLULUK KANITLARI
  // ══════════════════════════════════════════════════════════
  const ws3 = {}; let R3 = 0;
  const S3 = (c,r,cell) => set(ws3,c,r,cell);
  const YSL_KOY = '064E3B';
  const YSL_ORT = '065F46';

  S3(0,R3, C('UYUMLULUK KANITLARI', {name:'Calibri',sz:22,bold:true,color:{rgb:'A7F3D0'}}, YSL_KOY, ORTA, B_YESIL));
  for(let c=1;c<=6;c++) S3(c,R3,BOŞ(YSL_KOY)); R3++;
  S3(0,R3, C(firmaAdi+' | '+tarih+' | '+evet+' uyumlu kontrol', F.altbaslik, YSL_ORT, ORTA, null));
  for(let c=1;c<=6;c++) S3(c,R3,BOŞ(YSL_ORT)); R3 += 2;

  const U3hdr = ['#','Tedbir No','Alt Kategori','Kontrol Adı','Kritiklik','Kapsanan Tedbir','Danışman Uygulama Notu'];
  U3hdr.forEach((h,i) => {
    S3(i,R3, C(h, {name:'Calibri',sz:10,bold:true,color:{rgb:'ECFDF5'}}, '065F46', ORTA, B_İNCE));
  }); R3++;

  SORULAR_100.filter(q=>STATE.cevaplar[q.id]?.c==='evet').forEach((q,i) => {
    const cv = STATE.cevaplar[q.id];
    const rf = i%2===0 ? YSA : 'F0FDF4';
    const kritBg = q.kritiklik===3?KIA:q.kritiklik===2?SAA:YSA;
    const kritFont = q.kritiklik===3?F.kirmizB:q.kritiklik===2?F.sariB:F.yesilB;
    const kritLabel = q.kritiklik===3?'🔴 Yüksek':q.kritiklik===2?'🟡 Orta':'⚪ Düşük';

    S3(0,R3, C(i+1, F.kucuk, rf, ORTA, B_İNCE));
    S3(1,R3, C(q.tedbirNo, {name:'Courier New',sz:9,bold:true,color:{rgb:YSL_KOY}}, rf, ORTA, B_İNCE));
    S3(2,R3, C(shortCat(q.altKat), F.kucuk, rf, SOL, B_İNCE));
    S3(3,R3, C(q.tedbir, {name:'Calibri',sz:10,bold:true,color:{rgb:YSL_KOY}}, rf, SOL, B_İNCE));
    S3(4,R3, C(kritLabel, kritFont, kritBg, ORTA, B_İNCE));
    S3(5,R3, C(q.kapsananSayi||0, {name:'Calibri',sz:10,bold:true,color:{rgb:YSL}}, rf, ORTA, B_İNCE));
    S3(6,R3, C(cv.obs||'—', {name:'Calibri',sz:10,italic:true,color:{rgb:'374151'}}, rf, SOL, B_İNCE));
    R3++;
  });

  // Kapsam dışı bölümü
  const kapsamDisi = SORULAR_100.filter(q=>STATE.cevaplar[q.id]?.c==='kapsam');
  if (kapsamDisi.length) {
    R3++;
    S3(0,R3, C('KAPSAM DIŞI KONTROLLER', F.altbaslik, '374151', ORTA, B_İNCE));
    for(let c=1;c<=6;c++) S3(c,R3,BOŞ('374151')); R3++;
    kapsamDisi.forEach((q,i) => {
      const cv = STATE.cevaplar[q.id];
      const rf = i%2===0?GRA:'F8FAFC';
      S3(0,R3,C(i+1,F.kucuk,rf,ORTA,B_İNCE));
      S3(1,R3,C(q.tedbirNo,F.mono,rf,ORTA,B_İNCE));
      S3(2,R3,C(shortCat(q.altKat),F.kucuk,rf,SOL,B_İNCE));
      S3(3,R3,C(q.tedbir,{name:'Calibri',sz:10,bold:true,color:{rgb:GRI}},rf,SOL,B_İNCE));
      S3(4,R3,C('⬜ Kapsam Dışı',F.griN,rf,ORTA,B_İNCE));
      S3(5,R3,C('—',F.kucuk,rf,ORTA,B_İNCE));
      S3(6,R3,C(cv.obs||'—',{name:'Calibri',sz:10,italic:true,color:{rgb:GRI}},rf,SOL,B_İNCE));
      R3++;
    });
  }

  ws3['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:R3,c:6}});
  ws3['!merges'] = [{s:{r:0,c:0},e:{r:0,c:6}},{s:{r:1,c:0},e:{r:1,c:6}}];
  ws3['!cols'] = [{wch:5},{wch:13},{wch:22},{wch:35},{wch:12},{wch:13},{wch:60}];
  XLSX.utils.book_append_sheet(wb, ws3, '✅ Uyumluluk Kanıtları');

  // ══════════════════════════════════════════════════════════
  // SAYFA 4 — 1296 TEDBİR LİSTESİ
  // ══════════════════════════════════════════════════════════
  const ws4 = {}; let R4 = 0;
  const S4 = (c,r,cell) => set(ws4,c,r,cell);

  S4(0,R4, C('1296 TEDBİR TAM LİSTESİ', F.baslik, KOY, ORTA, B_ALTIN));
  for(let c=1;c<=7;c++) S4(c,R4,BOŞ(KOY)); R4++;
  S4(0,R4, C(firmaAdi+' | '+tarih+' | BİGR Kapsamı', F.altbaslik, LAC, ORTA, null));
  for(let c=1;c<=7;c++) S4(c,R4,BOŞ(LAC)); R4 += 2;

  const T4hdr = ['Tedbir No','Alt Kategori','Tedbir Adı','Denetim Sorusu','Durum','Bulgu / Tespit','Kaynak Soru'];
  T4hdr.forEach((h,i) => {
    S4(i,R4, C(h, F.beyazB, KOY, ORTA, B_İNCE));
  }); R4++;

  let mevcatGrup = '';
  SORULAR_1296.forEach(s => {
    const cv  = STATE.cevaplar1296[s.i]||'';
    const bulguObj = STATE.bulgu1296[s.i];
    const bulguText = bulguObj ? bulguObj.metin : '';
    const pQ  = SORULAR_100.find(q=>q.id===s.p);
    const alk = s.altk.replace(/^\d+\.\d+\.\d+\.\s*/,'').replace(/^\d+\.\d+\.\s*/,'');

    // Kategori başlık satırı
    if (s.ak !== mevcatGrup) {
      mevcatGrup = s.ak;
      S4(0,R4, C('▶  '+shortCat(s.ak), {name:'Calibri',sz:10,bold:true,color:{rgb:ALT}}, ORT, SOL, B_İNCE));
      for(let c=1;c<=7;c++) S4(c,R4,BOŞ(ORT));
      R4++;
    }

    const rfBg = cv==='evet'?YSA:cv==='kismi'?SAA:cv==='hayir'?KIA:cv==='kapsam'?GRA:BYZ;
    const cvLbl= cv==='evet'?'✅ Uyumlu':cv==='kismi'?'🟡 Kısmen':cv==='hayir'?'❌ Uyumsuz':cv==='kapsam'?'⬜ Kapsam Dışı':'— Cevapsız';
    const cvF  = cv==='evet'?F.yesilB:cv==='kismi'?F.sariB:cv==='hayir'?F.kirmizB:F.griN;

    S4(0,R4, C(s.tn, {name:'Courier New',sz:9,bold:true,color:{rgb:'1E293B'}}, rfBg, ORTA, B_İNCE));
    S4(1,R4, C(alk, F.kucuk, rfBg, SOL, B_İNCE));
    S4(2,R4, C(s.ta, {name:'Calibri',sz:10,bold:true,color:{rgb:'0F172A'}}, rfBg, SOL, B_İNCE));
    S4(3,R4, C(s.q, F.normal, rfBg, SOL, B_İNCE));
    S4(4,R4, C(cvLbl, cvF, rfBg, ORTA, B_İNCE));
    S4(5,R4, C(bulguText, {name:'Calibri',sz:10,italic:!!bulguObj,color:{rgb:bulguObj?.kaynak==='ai'?'4338CA':'374151'}}, rfBg, SOL, B_İNCE));
    S4(6,R4, C(pQ?('S'+s.p+': '+pQ.tedbir):'S'+s.p, {name:'Calibri',sz:9,color:{rgb:'6366F1'}}, rfBg, SOL, B_İNCE));
    R4++;
  });

  ws4['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:R4,c:7}});
  ws4['!merges'] = [{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}}];
  ws4['!cols'] = [{wch:13},{wch:22},{wch:30},{wch:52},{wch:16},{wch:60},{wch:32}];
  XLSX.utils.book_append_sheet(wb, ws4, '📋 1296 Tedbir');

  // ── KAYDET ────────────────────────────────────────────────
  const dosya = (firmaAdi.replace(/[^\w\s]/g,'').trim()||'Rapor')
    +'_BilgiGuvenligi_GapAnalizi_'+new Date().toISOString().split('T')[0]+'.xlsx';
  try {
    const wbout = XLSX.write(wb, { bookType:'xlsx', bookSST:false, type:'binary' });
    const buf = new ArrayBuffer(wbout.length);
    const view = new Uint8Array(buf);
    for (let i=0; i<wbout.length; i++) view[i] = wbout.charCodeAt(i) & 0xFF;
    const blob = new Blob([buf], { type:'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = dosya; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('✅ Excel raporu indirildi: ' + dosya, 'success');
  } catch(e) {
    toast('❌ Excel hatası: ' + e.message, 'error');
    console.error('Excel hatası:', e);
  }
}



// ══════════════════════════════════════════════════════════════
// API KEY / RESET / EXPORT
// ══════════════════════════════════════════════════════════════

function showAPIKeyModal() {
  document.getElementById('api-modal').classList.add('visible');
  document.getElementById('api-key-input').value = localStorage.getItem(API_KEY_STOR) || '';
}
function saveAPIKey() {
  const k = document.getElementById('api-key-input').value.trim();
  if (!k) { toast('Boş olamaz', 'error'); return; }
  if (k.length < 10) { toast('Geçersiz anahtar', 'error'); return; }  localStorage.setItem(API_KEY_STOR, k);
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
  if (!confirm('Tüm cevaplar, bulgular ve yapay zeka analizleri silinecek. Emin misiniz?')) return;
  
  // Tüm durum (state) verilerini fabrikasyon ayarlarına döndürüyoruz
  STATE.cevaplar     = {};
  STATE.cevaplar1296 = {};
  STATE.currentIdx   = 0;         // 🎯 1. sorudan başlamasını sağlıyoruz
  STATE.page1296     = 0;         // Sayfa 2'deki listeleme sayfasını sıfırlıyoruz
  STATE.activePage   = 'sorular'; // Kullanıcıyı doğrudan Soru Formu sekmesine yönlendiriyoruz
  STATE.activeFilter = 'all';     // Filtreleri temizliyoruz
  
  // Yeni eklediğimiz yapay zeka havuzları varsa onları da temizleyelim
  if (STATE.aiNotes) STATE.aiNotes = {};
  if (STATE.riskCache) STATE.riskCache = {};
  STATE.riskAnalizi = {};
  STATE.bulgu1296  = {};
  STATE.projeAdi = 'Yeni Proje';
  const pi = document.getElementById('proje-adi-input');
  if (pi) pi.value = '';

  // LocalStorage'ı tamamen temizleyip yeni temiz durumu kaydediyoruz
  localStorage.removeItem(STORAGE_KEY);
  save(); 

  // Arayüzü (UI) güncel durumla yeniden çiziyoruz
  buildSidebar();
  switchTab('sorular'); // Sekme geçişini tetikleyerek UI'ı tazeleyelim
  renderQuestion();
  updateStats();
  
  toast('✅ Tüm veriler sıfırlandı, 1. sorudan başlandı!');
}
// Risk Analizi Üretme Fonksiyonu



function exportData() {
  const dataStr = JSON.stringify(STATE, null, 2);
  const blob = new Blob([dataStr], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${STATE.projeAdi.replace(/\s+/g, '_')}_GapAnalizi.json`;
  a.click();
}

function pdfRapor() {
  const firmaAdi = STATE.projeAdi || 'Kurum Adı';
  const tarih = new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' });
  const all = Object.values(STATE.cevaplar);
  const evet  = all.filter(v=>v.c==='evet').length;
  const kismi = all.filter(v=>v.c==='kismi').length;
  const hayir = all.filter(v=>v.c==='hayir').length;
  const kapsam= all.filter(v=>v.c==='kapsam').length;
  const total = evet+kismi+hayir+kapsam;
  const skorBaz = evet+kismi+hayir;
  const skor = skorBaz>0 ? Math.round(100*(evet+kismi*0.5)/skorBaz) : 0;
  const skorRenk = skor>=70?'#059669':skor>=40?'#D97706':'#DC2626';
  const skorBg   = skor>=70?'#D1FAE5':skor>=40?'#FEF3C7':'#FEE2E2';
  const skorEtkt = skor>=70?'✅ Uyumlu Seviye':skor>=40?'⚠️ Geliştirilebilir':'❌ Kritik Seviye';

  // ── Kategori verileri ──────────────────────────────────────
  const katData = CATEGORIES.map(cat => {
    const qs = SORULAR_100.filter(q=>q.anaKat===cat);
    const ce = qs.filter(q=>STATE.cevaplar[q.id]?.c==='evet').length;
    const ck = qs.filter(q=>STATE.cevaplar[q.id]?.c==='kismi').length;
    const ch = qs.filter(q=>STATE.cevaplar[q.id]?.c==='hayir').length;
    const ct = qs.filter(q=>STATE.cevaplar[q.id]).length;
    const cs = ct>0?Math.round(100*(ce+ck*0.5)/ct):0;
    return { ad:shortCat(cat), ce, ck, ch, ct, cs };
  }).filter(k=>k.ct>0);

  // ── Bulgular ──────────────────────────────────────────────
  const bulgular = SORULAR_100
    .filter(q=>{ const cv=STATE.cevaplar[q.id]; return cv&&(cv.c==='hayir'||cv.c==='kismi'); })
    .sort((a,b)=>(riskDurumu(b,STATE.cevaplar[b.id].c)?.skor||0)-(riskDurumu(a,STATE.cevaplar[a.id].c)?.skor||0));

  // ── Uyumlular ─────────────────────────────────────────────
  const uyumlular = SORULAR_100.filter(q=>STATE.cevaplar[q.id]?.c==='evet');

  // ── YARDIMCI ──────────────────────────────────────────────
  const riskBadge = (rd) => {
    if(!rd) return '';
    const bg = rd.label==='Çok Riskli'?'#FEE2E2':rd.label==='Riskli'?'#FEF3C7':'#EDE9FE';
    const fg = rd.label==='Çok Riskli'?'#DC2626':rd.label==='Riskli'?'#D97706':'#7C3AED';
    return `<span style="background:${bg};color:${fg};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">${rd.label}</span>`;
  };

  const katBar = (pct) => {
    const bg = pct>=70?'#059669':pct>=40?'#D97706':'#DC2626';
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;background:#E2E8F0;border-radius:4px;height:8px">
        <div style="width:${pct}%;background:${bg};height:8px;border-radius:4px"></div>
      </div>
      <span style="font-size:11px;font-weight:700;color:${bg};min-width:36px">%${pct}</span>
    </div>`;
  };

  const bulguKart = (q, idx) => {
    const cv  = STATE.cevaplar[q.id];
    const rd  = riskDurumu(q, cv.c);
    const mev = lkp('mev', q.mev);
    const iso1= lkp('iso1', q.iso1);
    const iso2= lkp('iso2', q.iso2);
    const iso3= lkp('iso3', q.iso3);
    const rBorder = rd?.label==='Çok Riskli'?'#DC2626':rd?.label==='Riskli'?'#D97706':'#7C3AED';
    const rBg     = rd?.label==='Çok Riskli'?'#FFF5F5':rd?.label==='Riskli'?'#FFFBEB':'#FAF5FF';

    const tespit = cv.bulgu || (cv.c==='hayir'
      ? `Yapılan saha incelemelerinde "${q.tedbir}" kapsamındaki gerekliliklerin kurum bünyesinde uygulanmadığı tespit edilmiştir. ${q.altKat} alanına ilişkin tanımlı bir süreç veya kontrol mekanizması bulunmamaktadır.`
      : cv.obs ? `"${q.tedbir}" alanında kısmi uygulama tespit edilmiştir. ${cv.obs}` : `"${q.tedbir}" alanında kısmi uygulama tespit edilmiştir.`);

    const riskKatHTML = (() => {
      if(STATE.riskAnalizi[q.id]) {
        return `<div style="font-size:11px;color:#1E293B;line-height:1.7;background:#F8FAFC;padding:10px;border-radius:6px">${STATE.riskAnalizi[q.id].replace(/\n/g,'<br>')}</div>`;
      }
      const k = q.kritiklik; const isH = cv.c==='hayir';
      const isKisiselVeri = (q.anaKat||'').toLowerCase().includes('kişisel');
      const katlar = [
        { icon:'⚡', ad:'STRATEJİK', renk:'#DC2626',
          metin: isH ? `${q.tedbir} alanındaki kontrol eksikliği kurumun güvenlik stratejisini zayıflatmakta, üst yönetimin bilinçli risk kararları almasını engellemektedir.`
                     : `${q.tedbir} alanındaki kısmi uygulama, stratejik güvenlik hedeflerinin tam karşılanamamasına yol açmaktadır.` },
        { icon:'🔧', ad:'OPERASYONEL', renk:'#EA580C',
          metin: isH ? 'Tedbirin uygulanmaması operasyonel süreçlerin güvenlik açıklarına karşı korumasız kalmasına ve iş sürekliliğinin tehlikeye girmesine neden olmaktadır.'
                     : 'Kısmi uygulama operasyonel etkinliği sınırlandırmakta; tam uyum sağlanana kadar süreçlerde güvenlik açığı devam etmektedir.' },
        { icon:'💰', ad:'FİNANSAL', renk:'#D97706',
          metin: isKisiselVeri
            ? 'KVKK kapsamında idari para cezası ve tazminat riski doğmakta; veri ihlali durumunda mali yükümlülükler önemli ölçüde artabilmektedir.'
            : isH ? 'Olası güvenlik ihlali sonrasında olay müdahale, sistem kurtarma ve tazminat maliyetleri kurumun bütçesini ciddi biçimde etkileyebilir.'
                  : 'Eksikliğin giderilmemesi durumunda bütçelenmemiş güvenlik maliyetleri ve beklenmedik mali yükler gündeme gelebilir.' },
        { icon:'⚖️', ad:'MEVZUAT', renk:'#2563EB',
          metin: isKisiselVeri
            ? `KVKK'nın 12. maddesi kapsamında teknik ve idari tedbirlerin alınmaması, Kişisel Verileri Koruma Kurulu'nun idari yaptırım uygulamasına zemin hazırlamaktadır.`
            : mev ? `BİGR ${q.tedbirNo} kapsamında uyumsuzluk riski. ${mev.split('\n')[0]}`
                  : `BİGR ${q.tedbirNo} numaralı tedbire doğrudan uyumsuzluk teşkil etmektedir.` },
        { icon:'📣', ad:'İTİBAR', renk:'#7C3AED',
          metin: isKisiselVeri
            ? 'Kişisel veri ihlali durumunda kurumun kamuoyu nezdindeki güvenilirliği zedelenebilir; müşteri ve iş ortağı ilişkileri olumsuz etkilenebilir.'
            : isH ? 'Güvenlik açığının kamuoyuna yansıması veya bir ihlal yaşanması halinde kurumun sektördeki itibarı ve paydaş güveni ciddi biçimde sarsılabilir.'
                  : 'Eksikliğin devam etmesi durumunda yaşanabilecek güvenlik olayları kurumun itibarına kalıcı zarar verebilir.' },
      ];
      return katlar.map(kat=>`
        <div style="margin-bottom:6px;padding:7px 10px;background:#fff;border-radius:6px;border-left:3px solid ${kat.renk}">
          <div style="font-size:10px;font-weight:700;color:${kat.renk};margin-bottom:3px">${kat.icon} ${kat.ad}</div>
          <div style="font-size:11px;color:#374151;line-height:1.5">${kat.metin}</div>
        </div>`).join('');
    })();

    let mevHTML = '';
    if(mev) mevHTML += `<div style="margin-bottom:8px"><div style="font-size:10px;font-weight:700;color:#92400E;margin-bottom:4px">📜 İlgili Mevzuat</div>${mev.split('\n').filter(Boolean).map(s=>`<div style="font-size:11px;color:#374151;padding:2px 0;border-bottom:1px dashed #E2E8F0">• ${s.trim()}</div>`).join('')}</div>`;
    if(iso1||iso2||iso3) {
      let isoT = '';
      if(iso1) iso1.split('\n').filter(Boolean).forEach(v=>{ isoT+=`<span style="background:#EFF6FF;color:#1D4ED8;font-size:10px;padding:2px 6px;border-radius:4px;margin:2px 2px 0 0;display:inline-block">ISO 27001 ${v.trim()}</span>`; });
      if(iso2) iso2.split('\n').filter(Boolean).forEach(v=>{ isoT+=`<span style="background:#F0FDF4;color:#065F46;font-size:10px;padding:2px 6px;border-radius:4px;margin:2px 2px 0 0;display:inline-block">ISO 27701 ${v.trim()}</span>`; });
      if(iso3) iso3.split('\n').filter(Boolean).forEach(v=>{ isoT+=`<span style="background:#F5F3FF;color:#5B21B6;font-size:10px;padding:2px 6px;border-radius:4px;margin:2px 2px 0 0;display:inline-block">ISO 20000 ${v.trim()}</span>`; });
      mevHTML += `<div style="margin-bottom:6px"><div style="font-size:10px;font-weight:700;color:#374151;margin-bottom:4px">🏷 Standart Referanslar</div>${isoT}</div>`;
    }
    if(!mevHTML) mevHTML = `<div style="font-size:11px;color:#9CA3AF">BİGR ${q.tedbirNo} kapsamında.</div>`;

    const oneriLines = (q.oneri||'').split('\n').map(s=>s.trim()).filter(s=>s.length>5).slice(0,5);
    const oneriHTML = oneriLines.length ? oneriLines.map((l,i)=>`<div style="display:flex;gap:8px;margin-bottom:6px"><span style="background:#0D1B2E;color:#D4AF4A;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${i+1}</span><span style="font-size:11px;color:#374151;line-height:1.5">${l}</span></div>`).join('') : `<div style="font-size:11px;color:#9CA3AF">Kontrol mekanizması oluşturularak dokümante edilmelidir.</div>`;

    return `
    <div style="border:1px solid #E2E8F0;border-left:5px solid ${rBorder};border-radius:8px;margin-bottom:20px;background:${rBg};page-break-inside:avoid;overflow:hidden">
      <div style="background:#0D1B2E;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:10px;color:#D4AF4A;font-weight:600;letter-spacing:1px;margin-bottom:3px">DANIŞMANLIK GÖRÜŞÜ #${idx+1}</div>
          <div style="font-size:14px;font-weight:700;color:#FFFFFF">${q.tedbir}</div>
          <div style="font-size:11px;color:#94A3B8;margin-top:2px">${q.altKat} • ${q.tedbirNo}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          ${riskBadge(rd)}
          <span style="font-size:10px;color:#CBD5E1">${cv.c==='hayir'?'❌ Uygulanmıyor':'🟡 Kısmen Uygulanıyor'}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0;padding:0">
        <div style="padding:14px;border-right:1px solid #E2E8F0">
          <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ${rBorder}">🔍 Tespitler</div>
          <div style="font-size:12px;color:#1E293B;line-height:1.7">${tespit}</div>
          ${cv.obs&&cv.c==='kismi'&&!cv.bulgu?`<div style="margin-top:8px;padding:8px;background:#FFFBEB;border-radius:6px;font-size:11px;color:#92400E;font-style:italic">💬 Gözlem: ${cv.obs}</div>`:''}
        </div>
        <div style="padding:14px;border-right:1px solid #E2E8F0;background:rgba(0,0,0,0.01)">
          <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #6366F1">⚠️ Risk Analizi</div>
          <div style="margin-bottom:8px;padding:6px 10px;background:#fff;border-radius:6px;border:1px solid #E2E8F0;display:flex;justify-content:space-between">
            <span style="font-size:10px;color:#475569">Kritiklik Derecesi</span>
            <span style="font-size:10px;font-weight:700;color:#0D1B2E">${q.kritiklik===3?'🔴 Yüksek':q.kritiklik===2?'🟡 Orta':'⚪ Düşük'} (${q.kritiklik*4} Puan)</span>
          </div>
          ${riskKatHTML}
        </div>
        <div style="padding:14px;border-right:1px solid #E2E8F0">
          <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #2563EB">⚖️ Mevzuat Uyumu</div>
          ${mevHTML}
        </div>
        <div style="padding:14px">
          <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #059669">💡 İyileştirme Önerileri</div>
          ${oneriHTML}
        </div>
      </div>
      <div style="background:#F8FAFC;padding:8px 16px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:10px;color:#94A3B8;font-family:monospace">${q.tedbirNo} • S${q.id}/100 • ${q.kapsananSayi} Tedbir Kapsamı</span>
        <span style="font-size:10px;color:#6366F1">${STATE.bulgu1296?Object.entries(STATE.bulgu1296).filter(([k,v])=>SORULAR_1296.find(s=>s.i==k&&s.p==q.id)&&v.kaynak==='ai').length+' AI Bulgu':''}</span>
      </div>
    </div>`;
  };

  // ── HTML RAPORU ───────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${firmaAdi} — Bilgi Güvenliği Gap Analizi Raporu</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Calibri,Arial,sans-serif; color:#1E293B; background:#fff; }
  .sayfa { max-width:1100px; margin:0 auto; padding:0 30px; }
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .no-print { display:none!important; }
    .sayfa-kiriliyor { page-break-before:always; }
    @page { margin:15mm 12mm; size:A4 landscape; }
  }
  .print-btn {
    position:fixed; top:20px; right:20px; z-index:999;
    background:#0D1B2E; color:#D4AF4A; border:2px solid #D4AF4A;
    padding:10px 24px; border-radius:8px; font-size:14px; font-weight:700;
    cursor:pointer; display:flex; align-items:center; gap:8px;
  }
  .print-btn:hover { background:#D4AF4A; color:#0D1B2E; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨 PDF Olarak Kaydet</button>

<!-- ══ KAPAK ══ -->
<div style="background:#0D1B2E;min-height:280px;display:flex;flex-direction:column;justify-content:center;padding:50px 60px;position:relative;overflow:hidden">
  <div style="position:absolute;top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,#D4AF4A,#F5E49C,#D4AF4A)"></div>
  <div style="font-size:13px;color:#D4AF4A;font-weight:600;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">BİLGİ GÜVENLİĞİ GAP ANALİZİ RAPORU</div>
  <div style="font-size:36px;font-weight:800;color:#FFFFFF;margin-bottom:8px">${firmaAdi}</div>
  <div style="font-size:16px;color:#94A3B8;margin-bottom:30px">BİGR & KVKK Uyumluluk Değerlendirmesi</div>
  <div style="display:flex;gap:20px;flex-wrap:wrap">
    <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(212,175,74,0.3);padding:12px 20px;border-radius:8px">
      <div style="font-size:11px;color:#94A3B8;margin-bottom:3px">Rapor Tarihi</div>
      <div style="font-size:15px;font-weight:700;color:#FFFFFF">${tarih}</div>
    </div>
    <div style="background:${skorBg};border:2px solid ${skorRenk};padding:12px 20px;border-radius:8px">
      <div style="font-size:11px;color:${skorRenk};margin-bottom:3px;font-weight:600">Genel Uyum Skoru</div>
      <div style="font-size:28px;font-weight:800;color:${skorRenk}">%${skor}</div>
    </div>
    <div style="background:rgba(255,255,255,0.08);padding:12px 20px;border-radius:8px">
      <div style="font-size:11px;color:#94A3B8;margin-bottom:3px">Değerlendirme Kapsamı</div>
      <div style="font-size:15px;font-weight:700;color:#FFFFFF">${total}/100 Kontrol • 1296 Tedbir</div>
    </div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#D4AF4A,#F5E49C,#D4AF4A)"></div>
</div>

<!-- ══ YÖNETİM ÖZETİ ══ -->
<div class="sayfa" style="margin-top:40px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
    <div style="width:5px;height:32px;background:#D4AF4A;border-radius:3px"></div>
    <div style="font-size:20px;font-weight:800;color:#0D1B2E">Yönetim Özeti</div>
  </div>

  <!-- Metrik kartlar -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:28px">
    ${[
      { lbl:'Uyumlu', val:evet, bg:'#D1FAE5', fg:'#059669', icon:'✅' },
      { lbl:'Kısmen', val:kismi, bg:'#FEF3C7', fg:'#D97706', icon:'🟡' },
      { lbl:'Uyumsuz', val:hayir, bg:'#FEE2E2', fg:'#DC2626', icon:'❌' },
      { lbl:'Kapsam Dışı', val:kapsam, bg:'#F1F5F9', fg:'#64748B', icon:'⬜' },
      { lbl:'Toplam Bulgu', val:kismi+hayir, bg:'#EDE9FE', fg:'#7C3AED', icon:'📋' },
    ].map(k=>`
    <div style="background:${k.bg};border-radius:10px;padding:16px;text-align:center">
      <div style="font-size:11px;font-weight:700;color:${k.fg};margin-bottom:6px">${k.icon} ${k.lbl}</div>
      <div style="font-size:32px;font-weight:800;color:${k.fg}">${k.val}</div>
    </div>`).join('')}
  </div>

  <!-- Uyum skoru banner -->
  <div style="background:${skorBg};border:2px solid ${skorRenk};border-radius:10px;padding:16px 24px;margin-bottom:28px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:12px;font-weight:700;color:${skorRenk};text-transform:uppercase;letter-spacing:1px">${skorEtkt}</div>
      <div style="font-size:13px;color:#475569;margin-top:4px">${skorBaz} yanıtlanan kontrolün ağırlıklı ortalaması</div>
    </div>
    <div style="font-size:48px;font-weight:800;color:${skorRenk}">%${skor}</div>
  </div>

  <!-- Kategori tablosu -->
  <div style="margin-bottom:36px">
    <div style="font-size:14px;font-weight:700;color:#0D1B2E;margin-bottom:12px">Kategori Bazlı Uyum Analizi</div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#0D1B2E">
          <th style="padding:10px 14px;text-align:left;color:#D4AF4A;font-size:11px;font-weight:700">KATEGORİ</th>
          <th style="padding:10px 8px;text-align:center;color:#D4AF4A;font-size:11px;font-weight:700;width:70px">UYUMLU</th>
          <th style="padding:10px 8px;text-align:center;color:#D4AF4A;font-size:11px;font-weight:700;width:70px">KISMİ</th>
          <th style="padding:10px 8px;text-align:center;color:#D4AF4A;font-size:11px;font-weight:700;width:70px">UYUMSUZ</th>
          <th style="padding:10px 14px;text-align:left;color:#D4AF4A;font-size:11px;font-weight:700;width:200px">UYUM ORANI</th>
        </tr>
      </thead>
      <tbody>
        ${katData.map((k,i)=>`
        <tr style="background:${i%2===0?'#F8FAFC':'#FFFFFF'};border-bottom:1px solid #E2E8F0">
          <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#0F172A">${k.ad}</td>
          <td style="padding:10px 8px;text-align:center;font-size:12px;font-weight:700;color:#059669">${k.ce}</td>
          <td style="padding:10px 8px;text-align:center;font-size:12px;font-weight:700;color:#D97706">${k.ck}</td>
          <td style="padding:10px 8px;text-align:center;font-size:12px;font-weight:700;color:#DC2626">${k.ch}</td>
          <td style="padding:10px 14px">${katBar(k.cs)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>

<!-- ══ UYUMLULUK KANITLARI ══ -->
<div class="sayfa sayfa-kiriliyor">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-top:30px">
    <div style="width:5px;height:32px;background:#059669;border-radius:3px"></div>
    <div>
      <div style="font-size:20px;font-weight:800;color:#0D1B2E">Uyumluluk Kanıtları</div>
      <div style="font-size:13px;color:#64748B;margin-top:2px">${evet} uyumlu kontrol</div>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="background:#065F46">
        <th style="padding:10px 12px;text-align:left;color:#A7F3D0;font-size:11px">#</th>
        <th style="padding:10px 12px;text-align:left;color:#A7F3D0;font-size:11px">TEDBİR NO</th>
        <th style="padding:10px 12px;text-align:left;color:#A7F3D0;font-size:11px">KATEGORİ</th>
        <th style="padding:10px 12px;text-align:left;color:#A7F3D0;font-size:11px">KONTROL ADI</th>
        <th style="padding:10px 12px;text-align:center;color:#A7F3D0;font-size:11px">KRİTİKLİK</th>
        <th style="padding:10px 12px;text-align:left;color:#A7F3D0;font-size:11px">UYGULAMA NOTU</th>
      </tr>
    </thead>
    <tbody>
      ${uyumlular.map((q,i)=>{
        const cv=STATE.cevaplar[q.id];
        const bg=i%2===0?'#F0FDF4':'#FFFFFF';
        const kBg=q.kritiklik===3?'#FEE2E2':q.kritiklik===2?'#FEF3C7':'#D1FAE5';
        const kFg=q.kritiklik===3?'#DC2626':q.kritiklik===2?'#D97706':'#059669';
        const kLbl=q.kritiklik===3?'🔴 Yüksek':q.kritiklik===2?'🟡 Orta':'⚪ Düşük';
        return `<tr style="background:${bg};border-bottom:1px solid #D1FAE5">
          <td style="padding:9px 12px;font-size:11px;color:#6B7280">${i+1}</td>
          <td style="padding:9px 12px;font-size:11px;font-family:monospace;font-weight:700;color:#065F46">${q.tedbirNo}</td>
          <td style="padding:9px 12px;font-size:11px;color:#374151">${shortCat(q.altKat)}</td>
          <td style="padding:9px 12px;font-size:12px;font-weight:600;color:#064E3B">${q.tedbir}</td>
          <td style="padding:9px 12px;text-align:center"><span style="background:${kBg};color:${kFg};font-size:10px;padding:2px 8px;border-radius:8px;font-weight:700">${kLbl}</span></td>
          <td style="padding:9px 12px;font-size:11px;color:#374151;font-style:italic">${cv.obs||'—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>

<!-- ══ BULGULAR ══ -->
<div class="sayfa sayfa-kiriliyor">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;padding-top:30px">
    <div style="width:5px;height:32px;background:#DC2626;border-radius:3px"></div>
    <div>
      <div style="font-size:20px;font-weight:800;color:#0D1B2E">Bulgular ve Tespitler</div>
      <div style="font-size:13px;color:#64748B;margin-top:2px">Risk seviyesine göre sıralanmış ${bulgular.length} bulgu</div>
    </div>
  </div>
  <!-- Risk renk açıklaması -->
  <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
    <span style="background:#FEE2E2;color:#DC2626;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">🔴 Çok Riskli</span>
    <span style="background:#FEF3C7;color:#D97706;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">🟡 Riskli</span>
    <span style="background:#EDE9FE;color:#7C3AED;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">🟣 Orta Riskli</span>
  </div>
  ${bulgular.map((q,i)=>bulguKart(q,i)).join('')}
</div>

<!-- ══ FOOTER ══ -->
<div style="background:#0D1B2E;margin-top:50px;padding:24px 60px;display:flex;justify-content:space-between;align-items:center">
  <div style="font-size:12px;color:#94A3B8">Bilgi Güvenliği Gap Analizi • BİGR & KVKK • ${tarih}</div>
  <div style="font-size:12px;color:#D4AF4A;font-weight:700">${firmaAdi}</div>
</div>

</body>
</html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}


// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();
  buildSidebar();
  updateStats();

  // Firma adını input'a yükle
  const projeInput = document.getElementById('proje-adi-input');
  if (projeInput && STATE.projeAdi && STATE.projeAdi !== 'Yeni Proje') {
    projeInput.value = STATE.projeAdi;
  }

  if (STATE.activePage !== 'sorular') {
    switchTab(STATE.activePage);
  } else {
    renderQuestion();
  }

  if (STATE.activeFilter !== 'all') {
    const idx = CATEGORIES.indexOf(STATE.activeFilter);
    if (idx >= 0) {
      const el = document.getElementById(`cat-${idx}`);
      if (el) {
        document.querySelectorAll('.cat-item').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
      }
    }
  }
});
