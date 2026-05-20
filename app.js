// ══════════════════════════════════════════════════════════════
// Bilgi Güvenliği Gap Analizi v4 — Temiz Versiyon
// ══════════════════════════════════════════════════════════════

const STORAGE_KEY  = 'bg_gap_v4';
const API_KEY_STOR = 'bg_gemini_key';
const PUAN = { evet: 1, kismi: 0.5, hayir: 0 };
const PAGE_SIZE_1296 = 50;

const STATE = {
  cevaplar: {},
  cevaplar1296: {},
  currentIdx: 0,
  activeFilter: 'all',
  activePage: 'sorular',
  page1296: 0,
  aiNotes: {},     // Yapay zeka verilerini tutacağımız alan
  riskCache: {}    // Aynı zafiyet maddelerini hafızada tutacak önbellek havuzumuz 🎯
};

const CATEGORIES = [...new Set(SORULAR_100.map(s => s.anaKat))];

// ── STORAGE ──────────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cevaplar:     STATE.cevaplar,
      cevaplar1296: STATE.cevaplar1296,
      currentIdx:   STATE.currentIdx,
      activeFilter: STATE.activeFilter,
      activePage:   STATE.activePage
    }));
  } catch(e) {}
}

function load() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (!r) return;
    const d = JSON.parse(r);
    STATE.cevaplar     = d.cevaplar     || {};
    STATE.cevaplar1296 = d.cevaplar1296 || {};
    STATE.currentIdx   = d.currentIdx   || 0;
    STATE.activeFilter = d.activeFilter || 'all';
    STATE.activePage   = d.activePage   || 'sorular';
  } catch(e) {}
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
  return { evet:'Tamamen Uygulanıyor', kismi:'Kısmen Uygulanıyor', hayir:'Uygulanmıyor' }[c] || '—';
}

function riskDurumu(q, cevap) {
  const k = q.kritiklik;
  if (cevap === 'evet') return null;
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
  if (np >= 0 && np < list.length) {
    STATE.currentIdx = SORULAR_100.indexOf(list[np]);
    renderQuestion();
    save();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderQuestion() {
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

  const borderColor = sel==='evet' ? 'rgba(16,185,129,0.3)' : sel==='kismi' ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)';
  const bgColor     = sel==='evet' ? 'rgba(16,185,129,0.06)' : sel==='kismi' ? 'rgba(245,158,11,0.06)' : 'rgba(239,68,68,0.06)';
  const panelColor  = sel==='evet' ? '#10b981' : sel==='kismi' ? '#f59e0b' : '#f87171';
  const panelTitle  = sel==='evet'  ? '✅ Uygulama Notları'
                    : sel==='kismi' ? '🟡 Danışman Gözlemi'
                    : '❌ Tespit Notları';
  const panelDesc   = sel==='evet'  ? 'Kontrolün nasıl uygulandığını, kanıtları ve gözlemlerinizi yazın.'
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
      </div>
      ${sel ? `
      <div style="margin-top:1rem;padding:1.25rem;border-radius:10px;border:1px solid ${borderColor};background:${bgColor}">
        <div style="font-size:12px;font-weight:600;margin-bottom:5px;color:${panelColor}">${panelTitle}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:7px">${panelDesc}</div>
        <textarea id="kismi-obs"
          style="width:100%;min-height:85px;padding:9px;background:var(--bg);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:var(--text);font-size:13px;line-height:1.6;resize:vertical;font-family:inherit"
          placeholder="Gözlem notlarınızı buraya yazın...">${obs}</textarea>
        <div style="display:flex;gap:7px;margin-top:7px;justify-content:flex-end">
          ${sel !== 'evet' ? `<button class="btn-ai" id="ai-gen-btn" onclick="bulguUret()" ${!obs.trim() ? 'disabled' : ''}>🤖 Bulgu Üret</button>` : ''}
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

// ── setCevap ─────────────────────────────────────────────────
function setCevap(val) {
  const q           = SORULAR_100[STATE.currentIdx];
  const mevcut      = STATE.cevaplar[q.id] || {};
  const oncekiCevap = mevcut.c || null;
  const obsTemizle  = oncekiCevap && oncekiCevap !== val;

  STATE.cevaplar[q.id] = {
    c:     val,
    obs:   obsTemizle ? '' : (mevcut.obs   || ''),
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
${iso1 ? `- ISO 27001:2022: ${iso1.replace(/\n/g,', ')}` : ''}
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
  const evet   = all.filter(v => v.c === 'evet').length;
  const kismi  = all.filter(v => v.c === 'kismi').length;
  const hayir  = all.filter(v => v.c === 'hayir').length;
  const total  = evet + kismi + hayir;
  const skor   = total > 0 ? Math.round(100*(evet + kismi*0.5)/total) : null;
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
    if (!cv || cv.c === 'evet') return false;
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
      icon: '⚖️', name: 'HUKUKİ', color: '#60a5fa',
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
    <div style="margin-bottom:9px;padding:8px 10px;background:rgba(0,0,0,0.18);border-radius:6px;border-left:3px solid ${cat.color}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:10px;font-weight:700;color:${cat.color};letter-spacing:.5px">${cat.icon} ${cat.name}</span>
        <div style="display:flex;gap:4px">
          <span style="font-size:9px;background:rgba(255,255,255,0.08);color:#e2e8f0;padding:2px 6px;border-radius:4px;font-weight:600">Etki ${cat.etki}</span>
          <span style="font-size:9px;background:rgba(255,255,255,0.08);color:#e2e8f0;padding:2px 6px;border-radius:4px;font-weight:600">Olasılık ${cat.olas}</span>
        </div>
      </div>
      <div style="font-size:11px;color:#d1d5db;line-height:1.5">${cat.desc}</div>
    </div>
  `).join('');
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
      <div class="dk-mev-text">${mev}</div>
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
  const oneriLines = (q.oneri || '').split(/\n|•|-/).map(s => s.trim()).filter(s => s.length > 15);
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
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">⚠️</span> Risk Analizi</div>
      
      <div class="dk-risk-item">
        <span class="dk-risk-label etkisel">Etki (${etkiPuani} Puan)</span>
        <div class="dk-risk-text">${etkiselAciklama}</div>
      </div>
      
      <div class="dk-risk-item">
        <span class="dk-risk-label kritiklik">Kritiklik (${q.kritiklik * 4} Puan)</span>
        <div class="dk-risk-text">BİGR Rehberi Kritiklik Derecesi: <strong>${q.kritiklik === 3 ? 'Yüksek (3)' : q.kritiklik === 2 ? 'Orta (2)' : 'Düşük (1)'}</strong></div>
      </div>
      
      <div class="dk-risk-item">
        <span class="dk-risk-label hukuki">Hukuki Risk</span>
        <div class="dk-risk-text" style="font-size:12px; line-height:1.5; color:var(--text); font-weight:500;">
          ⚠️ ${cv.c === 'hayir' ? 'Yüksek Uyumsuzluk Riski: ' : 'Kısmi Uyumsuzluk Riski: '}
          <div style="margin-top: 4px; font-weight: normal; color: var(--text2); white-space: pre-line;">${hukukiAks}</div>
        </div>
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
  let html = `<div style="font-size:13px;color:var(--text2);margin-bottom:1.25rem">
    ${sorular.length} uyumlu kontrol &nbsp;•&nbsp; ${notlu} tanesi uygulama notu içeriyor
    &nbsp;•&nbsp; ${sorular.reduce((s,q) => s+q.kapsananSayi, 0).toLocaleString('tr-TR')} tedbir kapsanıyor
  </div>`;

  html += '<div style="display:flex;flex-direction:column;gap:1rem">';

  sorular.forEach(q => {
    const cv   = STATE.cevaplar[q.id];
    const obs  = (cv.obs || '').trim();
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

function renderPage1296() {
  const container = document.getElementById('page-1296-container');
  if(!container) return;
  container.innerHTML = '';

  const eksikler = SORULAR_1296.filter(q => {
    const cv = STATE.cevaplar1296[q.i];
    return cv && (cv.c === 'hayir' || cv.c === 'kismi');
  });

  if(eksikler.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text2);">Tam uyumsuz veya kısmi uyumlu madde bulunamadı. Raporlama için soru formunda "Hayır" veya "Kısmen" cevapları verilmelidir.</div>';
    return;
  }

  // Üst Kontrol Paneli ve Toplu AI Analiz Butonu
  let html = `
    <div style="background:var(--bg2); border:1px solid var(--border); padding:15px; border-radius:8px; margin-bottom:20px; display:flex; justify-content:between; align-items:center; gap:15px; flex-wrap:wrap;">
      <div>
        <h3 style="margin:0 0 5px 0; font-size:14px; color:var(--text);">🤖 Gelişmiş Danışmanlık ve Kurumsal Risk Raporu</h3>
        <p style="margin:0; font-size:12px; color:var(--text2);">Toplam <strong style="color:var(--danger)">${eksikler.length}</strong> adet zafiyet/bulgu maddesi listeleniyor.</p>
      </div>
      <button id="btn-ai-all-1296" class="btn-primary" style="background:linear-gradient(135deg, #4f46e5, #7c3aed); border:none; display:flex; align-items:center; gap:6px;">
        ⚡ Tüm Eksik Maddeleri Akıllı AI ile Analiz Et (Önbellek Korumalı)
      </button>
    </div>
    <div style="display:flex; flex-direction:column; gap:25px;">
  `;

  eksikler.forEach(q => {
    const cv = STATE.cevaplar1296[q.i];
    const etkiPuani = q.k * (cv.c === 'hayir' ? 4 : 3);
    
    // Varsayılan / Fallback Kurumsal Cümleler (AI çalıştırılmadıysa arayüzün boş kalmaması için güvence)
    let rOperasyonel = cv.c === 'hayir' ? "Kritik iş süreçlerinde kesinti ve sistemlerin durması riski mevcuttur." : "Uygulamanın tam olmaması süreçte operasyonel gri alanlar yaratmaktadır.";
    let rFinansal    = cv.c === 'hayir' ? "KVKK idari para cezaları ve uyumsuzluk yaptırımları riski yüksektir." : "Kısmi uyumsuzluk bütçe planlamalarında öngörülemeyen maliyetler üretebilir.";
    let rItibar      = cv.c === 'hayir' ? "Olası veri ihlali durumunda marka değerinde ağır zedelenme riski." : "İç kontrol yetersizliği algısı paydaş güvenini sarsabilir.";
    let rStratejik   = cv.c === 'hayir' ? "Kurumun siber olgunluk vizyonu ve regülatif uyum hedefleri engellenmektedir." : "Hedeflenen tam uyum vizyonunun gerisinde kalınmaktadır.";

    // Eğer bu soru için AI verisi üretilmişse nesneden çek
    let isAI = false;
    if (STATE.aiNotes && STATE.aiNotes[q.i] && typeof STATE.aiNotes[q.i] === 'object') {
      const aiObj = STATE.aiNotes[q.i];
      rOperasyonel = aiObj.operasyonel || rOperasyonel;
      rFinansal    = aiObj.finansal || rFinansal;
      rItibar      = aiObj.itibar || rItibar;
      rStratejik   = aiObj.stratejik || rStratejik;
      isAI = true;
    }

    const mevTxt = lkp('mev', q.mev) || 'İlgili yasal mevzuat maddesi tanımlanmamıştır.';
    const iso1 = lkp('iso1', q.iso1);
    const iso2 = lkp('iso2', q.iso2);
    const iso3 = lkp('iso3', q.iso3);

    let standartlarHTML = '';
    if(iso1) iso1.split('\n').filter(Boolean).forEach(v => standartlarHTML += `<span style="display:inline-block; background:rgba(99,102,241,0.1); color:#818cf8; font-size:10px; padding:2px 6px; border-radius:4px; margin:2px;">ISO 27001: ${v.trim()}</span>`);
    if(iso2) iso2.split('\n').filter(Boolean).forEach(v => standartlarHTML += `<span style="display:inline-block; background:rgba(16,185,129,0.1); color:#34d399; font-size:10px; padding:2px 6px; border-radius:4px; margin:2px;">ISO 27701: ${v.trim()}</span>`);
    if(iso3) iso3.split('\n').filter(Boolean).forEach(v => standartlarHTML += `<span style="display:inline-block; background:rgba(245,158,11,0.1); color:#fbbf24; font-size:10px; padding:2px 6px; border-radius:4px; margin:2px;">ISO 20000: ${v.trim()}</span>`);

    let tespitMetni = cv.bulgu || (cv.c === 'hayir' 
      ? `Yapılan saha incelemelerinde ve denetim mülakatlarında, "${q.ta}" kapsamındaki gerekliliklerin kurum bünyesinde uygulanmadığı tespit edilmiştir. İlgili alana ilişkin tanımlı bir süreç, yürütülen bir kontrol mekanizması veya somut bir çalışma bulunmamaktadır. Bu durum, Bilgi ve İletişim Güvenliği Rehberi'nin (BİGR) ilgili maddelerine doğrudan uyumsuzluk teşkil etmektedir.`
      : `Denetim kapsamında ilgili tedbire ait süreçlerin kısmen işletildiği, ancak kurumsallaşma ve süreklilik boyutunda eksiklikler barındırdığı gözlemlenmiştir. Danışman Notu: ${cv.obs || 'Belirtilmedi'}`);

    html += `
      <div class="danisman-kart" style="background:var(--bg2); border:1px solid var(--border); border-radius:8px; padding:20px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
        <div style="display:flex; justify-content:between; align-items:start; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
          <div>
            <span style="font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#a855f7; font-weight:700;">${q.ak}</span>
            <h4 style="margin:2px 0; font-size:15px; color:var(--text);">${q.tn} — ${q.ta}</h4>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="btn-ai-single" data-id="${q.i}" style="background:linear-gradient(135deg, #6366f1, #a855f7); color:white; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:4px;">
              🤖 AI Risk Analizi
            </button>
            <span style="background:${cv.c==='hayir'?'rgba(239,68,68,0.15)':'rgba(245,158,11,0.15)'}; color:${cv.c==='hayir'?'#ef4444':'#f59e0b'}; font-size:11px; padding:3px 8px; border-radius:4px; font-weight:600;">
              ${cv.c==='hayir'?'❌ Uygulanmıyor':'🟡 Kısmen Uygulanıyor'}
            </span>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:20px;">
          <div style="background:rgba(255,255,255,0.01); border:1px solid var(--border); padding:12px; border-radius:6px;">
            <h5 style="margin:0 0 8px 0; font-size:12px; color:var(--text); display:flex; align-items:center; gap:5px;"><span style="color:#3b82f6">🔍</span> Bulgular ve Tespitler</h5>
            <p style="margin:0; font-size:11px; line-height:1.5; color:var(--text2); text-align:justify;">${tespitMetni}</p>
          </div>

          <div style="background:rgba(255,255,255,0.01); border:1px solid var(--border); padding:12px; border-radius:6px;">
            <h5 style="margin:0 0 8px 0; font-size:12px; color:var(--text); display:flex; align-items:center; gap:5px;">
              <span style="color:#ef4444">⚠️</span> Risk Etki Analizi 
              ${isAI ? '<span style="background:rgba(168,85,247,0.2); color:#c084fc; font-size:9px; padding:1px 4px; border-radius:3px; margin-left:5px; font-weight:600;">Dinamik AI</span>' : ''}
            </h5>
            <div style="font-size:10px; color:var(--text2); margin-bottom:8px; background:rgba(255,255,255,0.02); padding:3px; border-radius:4px;">
              Kritiklik: <strong>K${q.k}</strong> • Risk Skoru: <strong style="color:var(--danger)">${etkiPuani} Puan</strong>
            </div>
            
            <div style="display:flex; flex-direction:column; gap:6px; font-size:11px;">
              <div><strong style="color:#60a5fa">⚙️ Operasyonel:</strong> <span style="color:var(--text2)">${rOperasyonel}</span></div>
              <div><strong style="color:#34d399">💰 Finansal:</strong> <span style="color:var(--text2)">${rFinansal}</span></div>
              <div><strong style="color:#fbbf24">🎭 İtibar:</strong> <span style="color:var(--text2)">${rItibar}</span></div>
              <div><strong style="color:#c084fc">🎯 Stratejik:</strong> <span style="color:var(--text2)">${rStratejik}</span></div>
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.01); border:1px solid var(--border); padding:12px; border-radius:6px;">
            <h5 style="margin:0 0 8px 0; font-size:12px; color:var(--text); display:flex; align-items:center; gap:5px;"><span style="color:#10b981">⚖️</span> Regülasyon ve Uyum</h5>
            <div style="font-size:11px; color:var(--text2); margin-bottom:8px; line-height:1.4;"><strong>Hukuki Dayanak:</strong><br>${mevTxt}</div>
            <div style="margin-top:5px;">${standartlarHTML}</div>
          </div>

          <div style="background:rgba(255,255,255,0.01); border:1px solid var(--border); padding:12px; border-radius:6px;">
            <h5 style="margin:0 0 8px 0; font-size:12px; color:var(--text); display:flex; align-items:center; gap:5px;"><span style="color:#fbbf24">💡</span> Aksiyon ve İyileştirme Önerisi</h5>
            <p style="margin:0; font-size:11px; line-height:1.5; color:var(--text2); text-align:justify;">${q.o || 'Kontrol mekanizması kurumsal politikalar çerçevesinde tasarlanmalı ve işletilmelidir.'}</p>
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;

  // ── 3. TEKİL AI ANALİZ BUTONLARININ OLAY DİNLEYİCİSİ ──
  container.querySelectorAll('.btn-ai-single').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'));
      const q = SORULAR_1296.find(x => x.i === id);
      const cv = STATE.cevaplar1296[id];
      const cacheKey = `${q.tn}_${cv.c}`;

      // Önbellek Kontrolü (Cache Hit) ⚡
      if (STATE.riskCache[cacheKey]) {
        STATE.aiNotes[id] = STATE.riskCache[cacheKey];
        renderPage1296();
        toast('⚡ Risk analizi mükerrer maddeden ötürü önbellekten getirildi.');
        return;
      }

      const apiKey = localStorage.getItem(API_KEY_STOR);
      if(!apiKey) { toast('❌ Ayarlar sekmesinden API anahtarı girin.'); return; }

      btn.disabled = true; btn.innerText = '⏳ Analiz Ediliyor...';

      const durumText = cv.c === 'hayir' ? 'Uygulanmıyor' : 'Kısmen Uygulanıyor';
      const prompt = `Sen kıdemli bir Bilgi Güvenliği, GRC ve Kurumsal Siber Risk uzmanısın. BİGR denetiminde ${q.tn} nolu tedbirin (${q.ta}) "${durumText}" olduğu saptanmıştır. Soru: "${q.q}". Kategori: "${q.altk}". Üst yönetime sunulmak üzere kurumsal etki analizi yap ve bana giriş/gelişme metni olmadan, markdown kullanmadan sadece şu şablonda saf bir JSON döndür: {"operasyonel":"maksimum iki cümle","finansal":"maksimum iki cümle","itibar":"maksimum iki cümle","stratejik":"maksimum iki cümle"}`;

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });
        const d = await res.json();
        const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text;
        if(txt) {
          const parsedJSON = JSON.parse(txt.trim());
          STATE.aiNotes[id] = parsedJSON;
          STATE.riskCache[cacheKey] = parsedJSON; // Hafızaya at 🎯
          toast('🤖 AI Risk Analizi başarıyla üretildi.');
        } else {
          throw new Error();
        }
      } catch(e) {
        toast('❌ API hatası veya JSON ayrıştırma hatası.');
      } finally {
        renderPage1296();
      }
    });
  });

  // ── 4. TOPLU AI ANALİZ BUTONUNUN OLAY DİNLEYİCİSİ ──
  const btnAll = document.getElementById('btn-ai-all-1296');
  if(btnAll) {
    btnAll.addEventListener('click', async () => {
      const apiKey = localStorage.getItem(API_KEY_STOR);
      if(!apiKey) { toast('❌ Önce ayarlardan API anahtarı girin.'); return; }

      // Henüz AI analizi yapılmamış olan eksikleri filtrele
      const analizEdilecekler = eksikler.filter(q => !STATE.aiNotes[q.i]);

      if(analizEdilecekler.length === 0) {
        toast('🤖 Analiz edilecek yeni bir bulgu maddesi kalmadı.');
        return;
      }

      if(!confirm(`${analizEdilecekler.length} adet bulgu için toplu analiz başlatılacak. Aynı tedbire sahip mükerrer maddeler önbellekten kopyalanarak bütçeniz korunacaktır. Emin misiniz?`)) return;

      btnAll.disabled = true; btnAll.innerText = '⏳ Toplu Analiz Yürütülüyor...';

      for(let i = 0; i < analizEdilecekler.length; i++) {
        const q = analizEdilecekler[i];
        const cv = STATE.cevaplar1296[q.i];
        const cacheKey = `${q.tn}_${cv.c}`;

        // Döngü içi Önbellek Koruması (Deli gibi API harcamasını önler) ⚡
        if (STATE.riskCache[cacheKey]) {
          STATE.aiNotes[q.i] = STATE.riskCache[cacheKey];
          console.log(`[Toplu İşlem - Cache Hit] ${q.tn} hafızadan kopyalandı.`);
          continue;
        }

        const durumText = cv.c === 'hayir' ? 'Uygulanmıyor' : 'Kısmen Uygulanıyor';
        const prompt = `Sen kıdemli GRC uzmanısın. BİGR tedbir no ${q.tn} (${q.ta}) kurumda "${durumText}" durumundadır. Bana markdown kullanmadan şu şablonda sadece saf JSON döndür: {"operasyonel":"","finansal":"","itibar":"","stratejik":""}`;

        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" }
            })
          });
          const d = await res.json();
          const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text;
          if(txt) {
            const parsedJSON = JSON.parse(txt.trim());
            STATE.aiNotes[q.i] = parsedJSON;
            STATE.riskCache[cacheKey] = parsedJSON; // Sonraki adımlar için havuza kaydet
          }
        } catch(e) {
          console.error(`Soru ${q.i} analiz hatası:`, e);
        }

        // Arayüzün donup kilitlenmemesi için her 3 kartta bir canlı güncelle
        if(i % 3 === 0) renderPage1296();
      }

      btnAll.disabled = false;
      renderPage1296();
      toast('✅ Tüm rapor maddelerinin risk analizleri başarıyla tamamlandı!');
    });
  }
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
  const m = { '1-kismi':0,'2-kismi':0,'3-kismi':0,'1-hayir':0,'2-hayir':0,'3-hayir':0 };
  SORULAR_100.forEach(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv || cv.c==='evet') return;
    const key = `${q.kritiklik}-${cv.c}`;
    if (key in m) m[key]++;
  });
  const cell = (key, cls) => {
    const n = m[key];
    const lbl = cls==='critical'?'Çok Riskli':cls==='high'?'Riskli':'Orta';
    return `<div class="rm-cell ${cls}">${n>0?`<span class="rm-count">${n}</span><span style="font-size:9px">${lbl}</span>`:'<span class="rm-count-0">0</span>'}</div>`;
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
  const wb    = XLSX.utils.book_new();
  const tarih = new Date().toLocaleDateString('tr-TR');
  const all   = Object.values(STATE.cevaplar);
  const evet  = all.filter(v=>v.c==='evet').length;
  const kismi = all.filter(v=>v.c==='kismi').length;
  const hayir = all.filter(v=>v.c==='hayir').length;
  const total = evet+kismi+hayir;
  const skor  = total>0 ? Math.round(100*(evet+kismi*0.5)/total) : 0;

  // Özet
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['BİLGİ GÜVENLİĞİ GAP ANALİZİ - YÖNETİM ÖZETİ'],
    ['Oluşturulma Tarihi', tarih], [],
    ['KAPSAM','DEĞER','AÇIKLAMA'],
    ['Yanıtlanan Kontrol', total, '100 kontrol üzerinden'],
    ['Genel Uyum Skoru', skor+'%', 'Ağırlıklı ortalama'],
    ['Tamamen Uyumlu', evet, ''], ['Kısmen Uyumlu', kismi, ''], ['Uyumsuz', hayir, ''], ['Toplam Bulgu', kismi+hayir, ''], [],
    ['1296 TEDBİR KAPSAMASI'],
    ['Cevaplanan', Object.keys(STATE.cevaplar1296).length, ''],
    ['Uyumlu',    Object.values(STATE.cevaplar1296).filter(c=>c==='evet').length,  ''],
    ['Kısmen',    Object.values(STATE.cevaplar1296).filter(c=>c==='kismi').length, ''],
    ['Uyumsuz',   Object.values(STATE.cevaplar1296).filter(c=>c==='hayir').length, ''], [],
    ['KATEGORİ','Uyumlu','Kısmen','Uyumsuz','Uyum %'],
    ...CATEGORIES.map(cat => {
      const qs = SORULAR_100.filter(q=>q.anaKat===cat && STATE.cevaplar[q.id]);
      const e=qs.filter(q=>STATE.cevaplar[q.id].c==='evet').length;
      const k=qs.filter(q=>STATE.cevaplar[q.id].c==='kismi').length;
      const h=qs.filter(q=>STATE.cevaplar[q.id].c==='hayir').length;
      const n=qs.length;
      return [shortCat(cat),e,k,h,n>0?Math.round(100*(e+k*0.5)/n)+'%':'—'];
    })
  ]);
  ws1['!cols'] = [{wch:35},{wch:15},{wch:40}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Özet');

  // Bulgular
  const ws2_data = [['BULGULAR'],['Sıra','Tedbir No','Ana Kat','Alt Kat','Tedbir','Cevap','Risk','Gözlem','AI Bulgu','Öneri','Mevzuat','ISO 27001','ISO 27701']];
  SORULAR_100.filter(q=>{ const cv=STATE.cevaplar[q.id]; return cv&&cv.c!=='evet'; })
    .sort((a,b)=>(riskDurumu(b,STATE.cevaplar[b.id].c)?.skor||0)-(riskDurumu(a,STATE.cevaplar[a.id].c)?.skor||0))
    .forEach((q,i) => {
      const cv=STATE.cevaplar[q.id]; const rd=riskDurumu(q,cv.c);
      ws2_data.push([i+1,q.tedbirNo,q.anaKat,q.altKat,q.tedbir,cevapLabel(cv.c),rd?.label||'',cv.obs||'',cv.bulgu||'',q.oneri||'',lkp('mev',q.mev),lkp('iso1',q.iso1),lkp('iso2',q.iso2)]);
    });
  const ws2 = XLSX.utils.aoa_to_sheet(ws2_data);
  ws2['!cols'] = [{wch:5},{wch:12},{wch:25},{wch:25},{wch:35},{wch:20},{wch:12},{wch:50},{wch:50},{wch:50},{wch:50},{wch:15},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Bulgular');

  // Uyumluluk
  const ws3_data = [['UYUMLULUK KANITLARI'],['Sıra','Tedbir No','Ana Kat','Alt Kat','Tedbir','Kritiklik','Danışman Notu','Öneri','Kapsanan','ISO 27001']];
  SORULAR_100.filter(q=>STATE.cevaplar[q.id]?.c==='evet').forEach((q,i) => {
    const cv=STATE.cevaplar[q.id];
    ws3_data.push([i+1,q.tedbirNo,q.anaKat,q.altKat,q.tedbir,q.kritiklik===3?'Yüksek':q.kritiklik===2?'Orta':'Düşük',cv.obs||'',q.oneri||'',q.kapsananSayi,lkp('iso1',q.iso1)]);
  });
  const ws3 = XLSX.utils.aoa_to_sheet(ws3_data);
  ws3['!cols'] = [{wch:5},{wch:12},{wch:25},{wch:25},{wch:35},{wch:10},{wch:60},{wch:50},{wch:12},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Uyumluluk Kanıtları');

  // 1296 Tedbir
  const ws4_data = [['1296 TEDBİR TAM LİSTESİ'],['#','Tedbir No','Ana Kat','Alt Kat','Tedbir Adı','Denetim Sorusu','Cevap','Uygulama Durumu','Kaynak','Kritiklik','Mevzuat','ISO 27001']];
  SORULAR_1296.forEach((s,idx) => {
    const cv=STATE.cevaplar1296[s.i]||'';
    const pQ=SORULAR_100.find(q=>q.id===s.p);
    ws4_data.push([idx+1,s.tn,s.ak,s.altk,s.ta,s.q,cv,cevapLabel(cv)||'Cevapsız',pQ?`S${s.p}: ${pQ.tedbir}`:`S${s.p}`,s.k===3?'Yüksek':s.k===2?'Orta':'Düşük',lkp('mev',s.mev),lkp('iso1',s.iso1)]);
  });
  const ws4 = XLSX.utils.aoa_to_sheet(ws4_data);
  ws4['!cols'] = [{wch:5},{wch:12},{wch:25},{wch:25},{wch:35},{wch:60},{wch:8},{wch:25},{wch:45},{wch:10},{wch:50},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws4, '1296 Tedbir Listesi');

  XLSX.writeFile(wb, `BG-Gap-Analizi-${new Date().toISOString().split('T')[0]}.xlsx`);
  toast('✅ Excel raporu indirildi', 'success');
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
  STATE.cevaplar     = {};
  STATE.cevaplar1296 = {};
  STATE.page1296     = 0;
  localStorage.removeItem(STORAGE_KEY);
  buildSidebar();
  renderQuestion();
  updateStats();
  toast('✅ Sıfırlandı');
}

function exportData() {
  const d = { tarih:new Date().toISOString(), uygulama:'BG Gap Analizi v4', cevaplar:STATE.cevaplar, cevaplar1296:STATE.cevaplar1296 };
  const b = new Blob([JSON.stringify(d,null,2)], { type:'application/json' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = `bg-gap-${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(u);
  toast('✅ JSON yedek indirildi');
}

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();
  buildSidebar();
  updateStats();

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
