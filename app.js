// ══════════════════════════════════════════════════════════════
// Bilgi Güvenliği Gap Analizi - Tam Uygulama Mantığı
// Evet / Hayır / Kısmen → Danışmanlık Kartı Otomasyonu
// ══════════════════════════════════════════════════════════════

const STORAGE_KEY  = 'bg_gap_v3';
const API_KEY_STOR = 'bg_gemini_key';
const PUAN = { evet: 1, kismi: 0.5, hayir: 0 };

// ── STATE ──────────────────────────────────────────────────────
const STATE = {
  cevaplar: {},      // {q_id: {c:'evet'|'kismi'|'hayir', obs:'danışman gözlemi', bulgu:'üretilen bulgu'}}
  currentIdx: 0,
  activeFilter: 'all',
  activePage: 'sorular'
};

const CATEGORIES = [...new Set(SORULAR_100.map(s => s.anaKat))];

// ── STORAGE ────────────────────────────────────────────────────
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.cevaplar)); } catch(e) {}
}
function load() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) STATE.cevaplar = JSON.parse(r); } catch(e) {}
}

// ── UTILS ──────────────────────────────────────────────────────
function shortCat(c) { return c.replace(/^\d+\.\d+\.\s*/, ''); }
function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast visible ' + type;
  setTimeout(() => t.classList.remove('visible'), 3000);
}
function critBadge(k) {
  if (k===3) return `<span class="badge badge-red">🔴 Yüksek Kritiklik</span>`;
  if (k===2) return `<span class="badge badge-amber">🟡 Orta Kritiklik</span>`;
  return `<span class="badge badge-gray">⚪ Düşük Kritiklik</span>`;
}
function lkp(type, id) { return (id >= 0 && LOOKUPS[type]) ? (LOOKUPS[type][id] || '') : ''; }

// Risk hesabı: Kritiklik × Uygulama Skoru
function riskDurumu(q, cevap) {
  const k = q.kritiklik;
  if (cevap === 'evet') return null;
  if (cevap === 'hayir') {
    if (k === 3) return { label: 'Çok Riskli', cls: 'dk-risk-cok-riskli', skor: 12 };
    if (k === 2) return { label: 'Riskli', cls: 'dk-risk-riskli', skor: 8 };
    return { label: 'Orta Riskli', cls: 'dk-risk-orta', skor: 4 };
  }
  if (cevap === 'kismi') {
    if (k === 3) return { label: 'Riskli', cls: 'dk-risk-riskli', skor: 6 };
    if (k === 2) return { label: 'Orta Riskli', cls: 'dk-risk-orta', skor: 3 };
    return { label: 'Orta Riskli', cls: 'dk-risk-orta', skor: 2 };
  }
  return null;
}

// ── TABS ───────────────────────────────────────────────────────
function switchTab(name) {
  STATE.activePage = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  if (name === 'rapor') renderRapor();
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
      <div class="cat-badge" id="badge-${i}">${count}</div>
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
}

function renderQuestion() {
  const q = SORULAR_100[STATE.currentIdx];
  const list = filteredList();
  const pos = list.findIndex(s => s === q);
  document.getElementById('q-nav-info').textContent = `Soru ${pos + 1} / ${list.length}`;
  document.getElementById('prev-btn').disabled = pos <= 0;
  document.getElementById('next-btn').disabled = pos >= list.length - 1;
  document.getElementById('q-section-label').textContent = q.altKat;

  const cv = STATE.cevaplar[q.id] || null;
  const sel = cv ? cv.c : null;
  const obs = cv ? (cv.obs || '') : '';
  const bulgu = cv ? (cv.bulgu || '') : '';

  const mev = lkp('mev', q.mev);
  const iso1 = lkp('iso1', q.iso1);
  const iso2 = lkp('iso2', q.iso2);
  const iso3 = lkp('iso3', q.iso3);

  // Refs
  let refsHTML = '<div class="q-refs">';
  if (iso1) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 27001:2022</span><span class="ref-value">${iso1.replace(/\n/g,', ')}</span></span>`;
  if (iso2) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 27701:2019</span><span class="ref-value">${iso2.replace(/\n/g,', ')}</span></span>`;
  if (iso3) refsHTML += `<span class="ref-item"><span class="ref-label">ISO 20000-1</span><span class="ref-value">${iso3.replace(/\n/g,', ')}</span></span>`;
  if (mev) refsHTML += `<div class="ref-mev"><span class="ref-label">İlgili Mevzuat</span><span class="ref-mev-text">${mev}</span></div>`;
  refsHTML += '</div>';

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
<div style="margin-top:1rem;padding:1.25rem;border-radius:10px;border:1px solid ${
  sel==='evet' ? 'rgba(16,185,129,0.3)' :
  sel==='kismi' ? 'rgba(245,158,11,0.3)' :
  'rgba(239,68,68,0.3)'};background:${
  sel==='evet' ? 'rgba(16,185,129,0.06)' :
  sel==='kismi' ? 'rgba(245,158,11,0.06)' :
  'rgba(239,68,68,0.06)'}">
  <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:${
    sel==='evet'?'#10b981':sel==='kismi'?'#f59e0b':'#f87171'}">
    ${sel==='evet'?'✅ Uygulama Notları':sel==='kismi'?'🟡 Danışman Gözlemi':'❌ Tespit Notları'}
  </div>
  <div style="font-size:12px;color:#94a3b8;margin-bottom:8px">
    ${sel==='evet'
      ? 'Kontrolün nasıl uygulandığını, kanıtları ve gözlemlerinizi yazın.'
      : sel==='kismi'
      ? 'Mevcut durumu açıklayın. Bu metinden otomatik bulgu üretilecektir.'
      : 'Kontrolün neden uygulanmadığını, tespit edilen eksikliği yazın.'}
  </div>
  <textarea id="kismi-obs" style="width:100%;min-height:90px;padding:10px;background:var(--bg);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-size:13px;line-height:1.6;resize:vertical;font-family:inherit" placeholder="Gözlem notlarınızı buraya yazın...">${obs}</textarea>
  <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">
    ${sel!=='evet' ? `<button class="btn-ai" id="ai-gen-btn" onclick="bulguUret()" ${!obs.trim()?'disabled':''}>🤖 Bulgu Üret</button>` : ''}
  </div>
  ${bulgu ? `
  <div style="background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);border-radius:8px;padding:1rem;margin-top:.75rem">
    <div style="font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:.4rem">🤖 Üretilen Bulgu</div>
    <div style="font-size:12px;color:var(--text);line-height:1.6;white-space:pre-line">${bulgu}</div>
  </div>` : '<div id="bulgu-preview"></div>'}
</div>` : ''}
</div>`; 
  // Textarea dinleyici
  const ta = document.getElementById('kismi-obs');
  if (ta) {
    ta.addEventListener('input', () => {
      const val = ta.value.trim();
      // State'e kaydet (obs)
      if (!STATE.cevaplar[q.id]) STATE.cevaplar[q.id] = { c: 'kismi', obs: '', bulgu: '' };
      STATE.cevaplar[q.id].obs = ta.value;
      save();
      const btn = document.getElementById('ai-gen-btn');
      if (btn) btn.disabled = !val;
    });
  }
}

function setCevap(val) {
  const q = SORULAR_100[STATE.currentIdx];
  const mevcut = STATE.cevaplar[q.id] || {};

  if (val === 'evet') {
    STATE.cevaplar[q.id] = { c: 'evet', obs: mevcut.obs || '', bulgu: '' };
}
  if (val === 'hayir') {
    STATE.cevaplar[q.id] = { c: 'hayir', obs: mevcut.obs || '', bulgu: mevcut.bulgu || '' };
  }
  if (val === 'kismi') {
    STATE.cevaplar[q.id] = { c: 'kismi', obs: mevcut.obs || '', bulgu: mevcut.bulgu || '' };
  }
  save(); updateStats(); buildSidebar(); renderQuestion();
}

function bulguSil() {
  const q = SORULAR_100[STATE.currentIdx];
  if (STATE.cevaplar[q.id]) {
    STATE.cevaplar[q.id].bulgu = '';
    STATE.cevaplar[q.id].obs = '';
  }
  save(); renderQuestion();
}

function bulguyuTemizle() {
  const q = SORULAR_100[STATE.currentIdx];
  if (STATE.cevaplar[q.id]) STATE.cevaplar[q.id].bulgu = '';
  save();
  const pv = document.getElementById('bulgu-preview');
  if (pv) pv.innerHTML = '';
}

// AI ile bulgu üretimi (Kısmen için)
async function bulguUret() {
  const q = SORULAR_100[STATE.currentIdx];
  const ta = document.getElementById('kismi-obs');
  if (!ta || !ta.value.trim()) { toast('Gözlem metni boş olamaz', 'error'); return; }

  const apiKey = localStorage.getItem(API_KEY_STOR);
  if (!apiKey) { showAPIKeyModal(); return; }

  const obs = ta.value.trim();
  const btn = document.getElementById('ai-gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Üretiliyor...';

  const mev = lkp('mev', q.mev);
  const iso1 = lkp('iso1', q.iso1);

  const prompt = `Sen kıdemli bir BİGR (Bilgi ve İletişim Güvenliği Rehberi) ve KVKK baş denetçisisin. Aşağıdaki denetim kontrolü için danışman gözlemine dayalı profesyonel bulgu metni yaz.

KONTROL BİLGİSİ:
- Tedbir No: ${q.tedbirNo}
- Tedbir Adı: ${q.tedbir}
- Kategori: ${q.altKat}
- Kritiklik: ${q.kritiklik === 3 ? 'Yüksek' : q.kritiklik === 2 ? 'Orta' : 'Düşük'}
- İlgili Mevzuat: ${mev || 'BİGR Kapsamı'}
${iso1 ? `- ISO 27001:2022 Madde: ${iso1.replace(/\n/g,', ')}` : ''}
- BİGR Öneri: ${q.oneri || 'Standarda uygun uygulama'}

DANIŞMAN GÖZLEM NOTU:
"${obs}"

Şu formatta Türkçe, profesyonel denetim bulgusunu yaz (sadece Tespit metnini üret, başka açıklama ekleme):

Yapılan saha incelemesinde [tedbir alanı] kapsamında [gözlemlenen eksiklik/durum] tespit edilmiştir. [Mevcut durumun detayı]. Bu durum [riskin açıklaması] açısından önemli bir zafiyet oluşturmaktadır. [Yasal/standart dayanak ile sonuç cümlesi].

Metin 3-4 cümle, resmi ve akademik üslupta olmalı.`;

  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
      })
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';

    STATE.cevaplar[q.id].bulgu = text.trim();
    save();

    const pv = document.getElementById('bulgu-preview');
    if (pv) {
      pv.innerHTML = `
        <div class="bulgu-onizleme">
          <div class="bulgu-onizleme-title">
            🤖 Üretilen Bulgu Önizlemesi
            <button class="bulgu-onizleme-clear" onclick="bulguyuTemizle()">Temizle</button>
          </div>
          <div class="bulgu-onizleme-text">${text.trim()}</div>
        </div>`;
    }
    toast('✅ Bulgu metni üretildi', 'success');
  } catch(e) {
    toast('AI hatası: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🤖 Bulgu Üret';
  }
}

function updateStats() {
  const all = Object.values(STATE.cevaplar);
  const evet  = all.filter(v => v.c === 'evet').length;
  const kismi = all.filter(v => v.c === 'kismi').length;
  const hayir = all.filter(v => v.c === 'hayir').length;
  const total = evet + kismi + hayir;
  const skor  = total > 0 ? Math.round(100 * (evet + kismi*0.5) / total) : null;
  document.getElementById('h-evet').textContent  = evet;
  document.getElementById('h-kismi').textContent = kismi;
  document.getElementById('h-hayir').textContent = hayir;
  document.getElementById('h-score').textContent = skor !== null ? skor + '%' : '—';
  document.getElementById('prog').style.width = Math.round(100 * total / 100) + '%';
  document.getElementById('badge-sorular').textContent = total + '/100';
  const bulgular = hayir + kismi;
  document.getElementById('badge-rapor').textContent = bulgular + ' Bulgu';
}

// ══════════════════════════════════════════════════════════════
// SAYFA 2: DANIŞMANLIK RAPORU KARTLARI
// ══════════════════════════════════════════════════════════════

function renderRapor() {
  const filter = document.getElementById('rapor-filter')?.value || 'all';
  let sorular = SORULAR_100.filter(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv) return false;
    if (cv.c === 'evet') return false; // uyumlu = raporda yok
    if (filter === 'hayir') return cv.c === 'hayir';
    if (filter === 'kismi') return cv.c === 'kismi';
    if (filter === 'cokriskli') {
      const rd = riskDurumu(q, cv.c);
      return rd && rd.label === 'Çok Riskli';
    }
    if (filter === 'riskli') {
      const rd = riskDurumu(q, cv.c);
      return rd && rd.label === 'Riskli';
    }
    return true;
  });

  // Skor sırala: çok riskli önce
  sorular.sort((a, b) => {
    const ra = riskDurumu(a, STATE.cevaplar[a.id].c);
    const rb = riskDurumu(b, STATE.cevaplar[b.id].c);
    return (rb?.skor || 0) - (ra?.skor || 0);
  });

  const liste = document.getElementById('rapor-liste');
  const bos   = document.getElementById('rapor-bos');

  if (!sorular.length) {
    liste.innerHTML = '';
    bos.style.display = 'block';
    return;
  }
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

  // Tespit metni
  let tespitMetni = '';
  if (cv.c === 'kismi' && cv.bulgu) {
    tespitMetni = cv.bulgu;
  } else if (cv.c === 'kismi' && cv.obs) {
    tespitMetni = `Denetim kapsamında "${q.tedbir}" alanında kısmi uygulama tespit edilmiştir. Danışman notu: ${cv.obs}`;
  } else if (cv.c === 'hayir') {
    tespitMetni = `Yapılan incelemede, "${q.tedbir}" kapsamındaki gereklilikler kurumda hiçbir şekilde uygulanmamaktadır. ${q.altKat} alanına ilişkin tanımlı bir süreç veya kontrol mekanizması bulunmamaktadır. Bu durum, BİGR rehberinin ${q.tedbirNo} numaralı tedbir maddesine doğrudan aykırılık teşkil etmekte olup kurumun ilgili mevzuat kapsamındaki yükümlülüklerini karşılamadığını göstermektedir.`;
  } else {
    tespitMetni = `Kısmen uygulama durumu tespit edilmiştir. Detaylı gözlem notu eklenmemiştir.`;
  }

  // Risk Analizi metni
  const etkisel = cv.c === 'hayir'
    ? (q.kritiklik === 3 ? 'Tedbirin hiç uygulanmaması kuruma ciddi operasyonel, yasal ve itibar riski oluşturmaktadır. Güvenlik ihlali olasılığı yüksektir.'
     : q.kritiklik === 2 ? 'Tedbirin eksikliği, kurum varlıkları ve kişisel veriler üzerinde önemli risk yaratmaktadır.'
     : 'Orta düzey operasyonel risk söz konusudur.')
    : (q.kritiklik === 3 ? 'Kısmi uygulama, tam güvence sağlamamakta; kontrol etkinliği yetersiz kalmaktadır.'
     : 'Sürecin olgunlaşması için ek adım atılması gerekmektedir.');

  const hukukiRisk = `* ${q.tedbirNo} | ${cv.c === 'hayir' ? 'Olası Riskler: ' : 'Kısmi Risk: '}${q.kritiklik === 3 ? 'Yüksek' : q.kritiklik === 2 ? 'Orta' : 'Düşük'} Kritiklik (${q.kritiklik * (cv.c==='hayir'?4:3)} Puan)${mev ? `\n\n* Hukuki Yaptırım: ${mev.length > 200 ? mev.substring(0, 200) + '...' : mev}` : ''}`;

  // Mevzuat kolonunu oluştur
  let mevzuatHTML = '';
  if (mev) {
    mevzuatHTML += `<div class="dk-mev-item">
      <div class="dk-mev-baslik">📜 İlgili Mevzuat</div>
      <div class="dk-mev-text">${mev.length > 300 ? mev.substring(0, 300) + '...' : mev}</div>
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

  // Öneri kolonunu oluştur
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

  const isAI = cv.c === 'kismi' && cv.bulgu;

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
    <!-- 1. Tespitler -->
    <div class="dk-kolon">
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">🔍</span> Tespitler</div>
      <div class="dk-tespit-text">${tespitMetni}</div>
    </div>

    <!-- 2. Risk Analizi -->
    <div class="dk-kolon">
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">⚠️</span> Risk Analizi</div>
      <div class="dk-risk-item">
        <span class="dk-risk-label etkisel">Etki (${q.kritiklik * (cv.c==='hayir'?4:3)})</span>
        <div class="dk-risk-text">${etkisel}</div>
      </div>
      <div class="dk-risk-item">
        <span class="dk-risk-label kritiklik">Kritiklik (${q.kritiklik * 4})</span>
        <div class="dk-risk-text">BİGR kritiklik derecesi: <strong>${q.kritiklik === 3 ? 'Yüksek' : q.kritiklik === 2 ? 'Orta' : 'Düşük'}</strong></div>
      </div>
      <div class="dk-risk-item">
        <span class="dk-risk-label hukuki">Hukuki</span>
        <div class="dk-risk-text" style="white-space:pre-line">${hukukiRisk}</div>
      </div>
    </div>

    <!-- 3. Mevzuat Uyumu -->
    <div class="dk-kolon">
      <div class="dk-kolon-baslik"><span class="dk-kolon-baslik-icon">⚖️</span> Mevzuat Uyumu</div>
      ${mevzuatHTML}
    </div>

    <!-- 4. İyileştirme Önerileri -->
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
// SAYFA 3: YÖNETİM ÖZETİ
// ══════════════════════════════════════════════════════════════

let pieChart = null, barChart = null;

function renderOzet() {
  document.getElementById('ozet-tarih').textContent =
    new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' }) + ' tarihi itibarıyla';

  const all   = Object.values(STATE.cevaplar);
  const evet  = all.filter(v => v.c === 'evet').length;
  const kismi = all.filter(v => v.c === 'kismi').length;
  const hayir = all.filter(v => v.c === 'hayir').length;
  const total = evet + kismi + hayir;
  const skor  = total > 0 ? Math.round(100 * (evet + kismi*0.5) / total) : 0;

  // Kapsanan 1296 tedbir
  const kapsamQ = SORULAR_100.filter(q => STATE.cevaplar[q.id]);
  const kapsamTedbirEvet  = kapsamQ.filter(q => STATE.cevaplar[q.id].c === 'evet').reduce((s,q) => s + q.kapsananSayi, 0);
  const kapsamTedbirKismi = kapsamQ.filter(q => STATE.cevaplar[q.id].c === 'kismi').reduce((s,q) => s + q.kapsananSayi, 0);
  const kapsamTedbirHayir = kapsamQ.filter(q => STATE.cevaplar[q.id].c === 'hayir').reduce((s,q) => s + q.kapsananSayi, 0);

  document.getElementById('ozet-grid').innerHTML = `
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--teal)">${skor}%</div><div class="ozet-kart-lbl">Genel Uyum Skoru</div><div class="ozet-kart-sub">${total}/100 soru yanıtlandı</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--green)">${evet}</div><div class="ozet-kart-lbl">Uyumlu Kontrol</div><div class="ozet-kart-sub">${kapsamTedbirEvet} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--amber)">${kismi}</div><div class="ozet-kart-lbl">Kısmen Uyumlu</div><div class="ozet-kart-sub">${kapsamTedbirKismi} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--red)">${hayir}</div><div class="ozet-kart-lbl">Uyumsuz</div><div class="ozet-kart-sub">${kapsamTedbirHayir} tedbir</div></div>
    <div class="ozet-kart"><div class="ozet-kart-val" style="color:var(--purple)">${kismi + hayir}</div><div class="ozet-kart-lbl">Toplam Bulgu</div><div class="ozet-kart-sub">Raporda yer alan</div></div>`;

  buildPie(evet, kismi, hayir);
  buildBar();
  buildRiskMatris();
  buildKritikBulgular();
}

function buildPie(e, k, h) {
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('chart-pie'), {
    type: 'doughnut',
    data: {
      labels: ['Uyumlu', 'Kısmen', 'Uyumsuz'],
      datasets: [{ data: [e, k, h], backgroundColor: ['#10b981','#f59e0b','#ef4444'], borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 12, usePointStyle: true } } }
    }
  });
}

function buildBar() {
  const cats   = CATEGORIES;
  const labels = cats.map(c => shortCat(c).substring(0, 28));
  const data   = cats.map(cat => {
    const qs = SORULAR_100.filter(q => q.anaKat === cat && STATE.cevaplar[q.id]);
    if (!qs.length) return 0;
    const puan = qs.reduce((s, q) => s + (PUAN[STATE.cevaplar[q.id].c] || 0), 0);
    return Math.round(100 * puan / qs.length);
  });
  const colors = data.map(d => d >= 70 ? '#10b981' : d >= 40 ? '#f59e0b' : d > 0 ? '#ef4444' : '#475569');

  const h = Math.max(300, cats.length * 34 + 60);
  document.getElementById('chart-bar-wrap').style.height = h + 'px';
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('chart-bar'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` Uyum: %${c.raw}` } } }
    }
  });
}

function buildRiskMatris() {
  // 2×2 matris: Kritiklik (1-3) × Uygulama (Hayır/Kısmen)
  // Hücreler: [Düşük-Kısmen, Orta-Kısmen, Yüksek-Kısmen / Düşük-Hayır, Orta-Hayır, Yüksek-Hayır]
  const matris = {
    '1-kismi': 0, '2-kismi': 0, '3-kismi': 0,
    '1-hayir': 0, '2-hayir': 0, '3-hayir': 0
  };
  SORULAR_100.forEach(q => {
    const cv = STATE.cevaplar[q.id];
    if (!cv || cv.c === 'evet') return;
    const key = `${q.kritiklik}-${cv.c}`;
    if (key in matris) matris[key]++;
  });

  const cell = (key, cls) => {
    const n = matris[key];
    return `<div class="rm-cell ${cls}">${n > 0 ? `<span class="rm-count">${n}</span>` : '<span class="rm-count-0">0</span>'}`;
  };

  document.getElementById('risk-matris').innerHTML = `
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px">Satırlar: Uygulama Durumu | Sütunlar: Kritiklik Derecesi</div>
    <div class="risk-matris-grid">
      <div></div>
      <div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600;padding:4px">⚪ Düşük</div>
      <div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600;padding:4px">🟡 Orta</div>
      <div style="text-align:center;font-size:10px;color:var(--text2);font-weight:600;padding:4px">🔴 Yüksek</div>
      <div></div>

      <div class="rm-label row-label">🟡 Kısmen</div>
      ${cell('1-kismi','medium')}</div>
      ${cell('2-kismi','medium')}</div>
      ${cell('3-kismi','high')}</div>
      <div></div>

      <div class="rm-label row-label">❌ Hayır</div>
      ${cell('1-hayir','medium')}</div>
      ${cell('2-hayir','high')}</div>
      ${cell('3-hayir','critical')}</div>
      <div></div>
    </div>`;
}

function buildKritikBulgular() {
  const bulgular = SORULAR_100
    .filter(q => { const cv = STATE.cevaplar[q.id]; return cv && cv.c !== 'evet'; })
    .map(q => ({ q, cv: STATE.cevaplar[q.id], rd: riskDurumu(q, STATE.cevaplar[q.id].c) }))
    .sort((a, b) => (b.rd?.skor || 0) - (a.rd?.skor || 0))
    .slice(0, 10);

  if (!bulgular.length) {
    document.getElementById('kritik-bulgular').innerHTML = '<p style="color:var(--text2);font-size:13px">Henüz bulgu yok.</p>';
    return;
  }

  document.getElementById('kritik-bulgular').innerHTML = bulgular.map(({ q, cv, rd }) => `
    <div class="kritik-bulgu-item">
      <span class="kb-badge ${rd?.label === 'Çok Riskli' ? 'cr' : 'r'}">${rd?.label || 'Riskli'}</span>
      <div>
        <div class="kb-text">${q.tedbir}</div>
        <div class="kb-sub">${q.altKat} • ${cv.c === 'hayir' ? 'Uygulanmıyor' : 'Kısmen'} • ${q.tedbirNo}</div>
      </div>
    </div>`).join('');
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
  if (!k) { toast('API anahtarı boş', 'error'); return; }
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
  localStorage.removeItem(STORAGE_KEY);
  buildSidebar();
  renderQuestion();
  updateStats();
  toast('✅ Sıfırlandı');
}

function exportData() {
  const d = { tarih: new Date().toISOString(), uygulama: 'BG Gap Analizi v3', cevaplar: STATE.cevaplar };
  const b = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = `bg-gap-${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(u);
  toast('✅ Veriler indirildi');
}

// ── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();
  buildSidebar();
  renderQuestion();
  updateStats();
});
