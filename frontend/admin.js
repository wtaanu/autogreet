// ── CONFIG ──────────────────────────────────────────────────────
const PLAN_FEES  = { starter: 4999, growth: 8999, authority: 14999 };
const PLAN_MRR   = { starter: 0,    growth: 2499, authority: 3999  };

// ── STATE ────────────────────────────────────────────────────────
let clients = [];
let editingId = null;

// ── DEFAULT CLIENTS (Starter Pack — already onboarded) ───────────
const DEFAULT_CLIENTS = [
  {
    id: 1001, owner: 'Prerana Singh', business: 'Taste Tales',
    type: 'Delivery Only Restaurant', city: 'Lucknow',
    email: 'aritikasingh@gmail.com', phone: '7058113754',
    plan: 'starter', plan_label: '🟢 Starter',
    status: 'setup_in_progress', payment_status: 'paid',
    payment_amount: 4999, payment_date: '2026-03-28', payment_ref: 'MANUAL-001',
    reviews_before: 0, reviews_after: 0, target_reviews: 30,
    google_rating_before: 0, google_rating_after: 0,
    review_link: '', gmaps_url: '', tone: 'Warm & Friendly',
    setup_date: '2026-03-28', go_live_date: '',
    notes: 'First client. Payment collected manually 28 March 2026.',
    created_at: '2026-03-28T10:00:00.000Z'
  },
  {
    id: 1002, owner: 'Shrey Pathak', business: 'AP Designs and Creations',
    type: 'Interior Design Firm', city: 'Lucknow',
    email: '', phone: '9919988383',
    plan: 'starter', plan_label: '🟢 Starter',
    status: 'setup_in_progress', payment_status: 'paid',
    payment_amount: 4999, payment_date: '2026-03-28', payment_ref: 'MANUAL-002',
    reviews_before: 0, reviews_after: 0, target_reviews: 30,
    google_rating_before: 0, google_rating_after: 0,
    review_link: '', gmaps_url: '', tone: 'Professional & Friendly',
    setup_date: '2026-03-28', go_live_date: '',
    notes: 'Second client. Payment collected manually 28 March 2026.',
    created_at: '2026-03-28T11:00:00.000Z'
  }
];

// ── AUTH ─────────────────────────────────────────────────────────
const API = 'https://api.autogreet.in';

async function doLogin() {
  const key   = document.getElementById('pwd').value.trim();
  const errEl = document.getElementById('login-err');
  const btn   = document.querySelector('.login-btn');
  if (!key) return;
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const res = await fetch(API + '/api/clients', { headers: { 'x-admin-key': key } });
    if (res.ok) {
      localStorage.setItem('ag_admin_key', key);
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      init();
    } else {
      errEl.textContent   = 'Incorrect admin key. Please try again.';
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = '🔐 Login';
    }
  } catch (e) {
    errEl.textContent   = 'Connection error — check your internet connection.';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = '🔐 Login';
  }
}
function doLogout() {
  localStorage.removeItem('ag_admin_key');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('pwd').value = '';
  document.getElementById('login-err').style.display = 'none';
}

// ── INIT ─────────────────────────────────────────────────────────
function adminKey() { return localStorage.getItem('ag_admin_key') || ''; }

async function init() {
  document.getElementById('live-date').textContent = new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  document.getElementById('f-paydate').value = new Date().toISOString().split('T')[0];
  await loadClientsFromAPI();
  buildCharts();
}

async function loadClientsFromAPI() {
  try {
    const res = await fetch(API + '/api/clients', { headers: { 'x-admin-key': adminKey() } });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    // Normalise: backend rows use snake_case
    clients = (data || []).map(normaliseClient);
    // Merge with DEFAULT_CLIENTS that are not yet in DB (fallback for offline/fresh deploy)
    if (!clients.length) clients = DEFAULT_CLIENTS;
  } catch(e) {
    // Offline fallback — use localStorage cache or defaults
    const saved = localStorage.getItem('ag_clients');
    clients = saved ? JSON.parse(saved) : DEFAULT_CLIENTS;
  }
  localStorage.setItem('ag_clients', JSON.stringify(clients)); // cache
  renderAll();
}

function normaliseClient(row) {
  return {
    id:                   row.id,
    owner:                row.owner_name || row.owner || '',
    business:             row.business_name || row.business || '',
    type:                 row.business_type || row.type || '',
    city:                 row.city || 'Lucknow',
    email:                row.email || '',
    phone:                row.phone || '',
    plan:                 row.plan || 'starter',
    plan_label:           { starter:'🟢 Starter', growth:'⭐ Growth', authority:'👑 Authority' }[row.plan] || row.plan,
    status:               row.status || 'new',
    payment_status:       row.payment_status || 'pending',
    payment_amount:       Number(row.payment_amount) || 0,
    payment_date:         (row.payment_date||'').split('T')[0],
    payment_ref:          row.payment_ref || '',
    reviews_before:       Number(row.reviews_before) || 0,
    reviews_after:        Number(row.reviews_after) || 0,
    target_reviews:       Number(row.target_reviews) || 30,
    google_rating_before: Number(row.google_rating_before) || 0,
    google_rating_after:  Number(row.google_rating_after) || 0,
    review_link:          row.review_link || '',
    gmaps_url:            row.gmaps_url || '',
    notes:                row.notes || '',
    setup_date:           (row.setup_date || row.created_at || '').split('T')[0],
    go_live_date:         (row.go_live_date || '').split('T')[0],
    created_at:           row.created_at || ''
  };
}

// Legacy local save (used as cache only)
function saveClients() {
  localStorage.setItem('ag_clients', JSON.stringify(clients));
}

// ── NAVIGATION ────────────────────────────────────────────────────
const pageTitles = {
  overview: '📊 Overview', clients: '👥 All Clients',
  revenue: '💰 Revenue', onboard: '➕ Onboard New Client',
  demoleads: '📋 Demo Leads'
};
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.textContent.includes(pageTitles[name]?.slice(2))) n.classList.add('active');
  });
  document.getElementById('page-title').textContent = pageTitles[name] || name;
  if (name === 'demoleads') { loadDemoLeads(); return; }
  renderAll();
}

// ── RENDER ALL ────────────────────────────────────────────────────
function renderAll() {
  updateStats();
  renderOverviewTable();
  renderClients();
  renderRevenue();
}

// ── STATS ──────────────────────────────────────────────────────────
function updateStats() {
  const total   = clients.reduce((s,c) => s + (c.payment_amount||0), 0);
  const active  = clients.filter(c => c.status !== 'cancelled').length;
  const reviews = clients.reduce((s,c) => s + (c.reviews_after||0), 0);
  const pending = clients.filter(c => c.status === 'setup_in_progress' || c.status === 'new').length;
  const mrr     = clients.filter(c => c.plan !== 'starter' && c.status === 'active')
                          .reduce((s,c) => s + PLAN_MRR[c.plan], 0);
  const proj    = total + mrr * 12;
  const mnth    = clients.filter(c => c.payment_date?.startsWith(new Date().toISOString().slice(0,7)))
                          .reduce((s,c) => s + (c.payment_amount||0), 0);

  document.getElementById('s-revenue').textContent = '₹' + total.toLocaleString('en-IN');
  document.getElementById('s-revenue-sub').textContent = active + ' paying clients';
  document.getElementById('s-clients').textContent = active;
  document.getElementById('s-clients-sub').textContent = clients.length + ' total registered';
  document.getElementById('s-reviews').textContent = reviews;
  document.getElementById('s-pending').textContent = pending;
  document.getElementById('r-total').textContent   = '₹' + total.toLocaleString('en-IN');
  document.getElementById('r-month').textContent   = '₹' + mnth.toLocaleString('en-IN');
  document.getElementById('r-mrr').textContent     = '₹' + mrr.toLocaleString('en-IN');
  document.getElementById('r-projected').textContent = '₹' + proj.toLocaleString('en-IN');
}

// ── OVERVIEW TABLE ─────────────────────────────────────────────────
function renderOverviewTable() {
  const tbody = document.getElementById('overview-table');
  if (!clients.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty"><div class="empty-icon">👥</div>No clients yet</td></tr>'; return; }
  tbody.innerHTML = clients.slice(0,5).map(c => `
    <tr>
      <td><div class="client-name">${c.business}</div><div class="client-biz">${c.owner} · ${c.city}</div></td>
      <td><span class="badge badge-${c.plan}">${c.plan_label||c.plan}</span></td>
      <td><span class="badge badge-${c.payment_status}">${c.payment_status==='paid'?'✅ Paid':'⏳ Pending'}</span></td>
      <td><span class="badge badge-${c.status}">${statusLabel(c.status)}</span></td>
      <td>${c.reviews_after||0} / ${c.target_reviews||30}</td>
      <td><div class="action-row">
        <button class="act-btn" onclick="openDetail(${c.id})">✏️ Edit</button>
        <button class="act-btn" onclick="sendWA(${c.id})">💬 WA</button>
      </div></td>
    </tr>`).join('');
}

// ── CLIENTS TABLE ──────────────────────────────────────────────────
function renderClients() {
  const q     = (document.getElementById('client-search')?.value||'').toLowerCase();
  const list  = q ? clients.filter(c => (c.business+c.owner+c.city).toLowerCase().includes(q)) : clients;
  document.getElementById('client-count').textContent = `(${list.length})`;
  const tbody = document.getElementById('clients-table');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty"><div class="empty-icon">🔍</div>No clients found</td></tr>'; return; }
  tbody.innerHTML = list.map((c,i) => `
    <tr>
      <td style="color:var(--muted)">${i+1}</td>
      <td><div class="client-name">${c.business}</div><div class="client-biz">${c.type}</div></td>
      <td><div style="font-size:13px">${c.owner}</div><div class="client-biz">📱 ${c.phone}</div></td>
      <td><span class="badge badge-${c.plan}">${c.plan_label||c.plan}</span></td>
      <td>
        <div style="font-size:13px;color:${c.payment_status==='paid'?'var(--green)':'var(--gold)'}">₹${(c.payment_amount||0).toLocaleString('en-IN')}</div>
        <div class="client-biz">${c.payment_date||'—'}</div>
      </td>
      <td><span class="badge badge-${c.status}">${statusLabel(c.status)}</span></td>
      <td>
        <div style="font-size:13px">${c.reviews_after||0} new</div>
        <div class="progress-bar-wrap" style="width:80px">
          <div class="progress-bar" style="width:${Math.min(100,((c.reviews_after||0)/(c.target_reviews||30))*100)}%"></div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--muted)">${c.setup_date||'—'}</td>
      <td><div class="action-row">
        <button class="act-btn" onclick="openDetail(${c.id})">✏️</button>
        <button class="act-btn" onclick="sendWA(${c.id})">💬</button>
        <button class="act-btn danger" onclick="deleteClient(${c.id})">🗑</button>
      </div></td>
    </tr>`).join('');
}

// ── REVENUE TABLE ──────────────────────────────────────────────────
function renderRevenue() {
  const tbody = document.getElementById('revenue-table');
  tbody.innerHTML = clients.map((c,i) => `
    <tr>
      <td style="color:var(--muted)">${i+1}</td>
      <td style="font-size:12px;color:var(--muted)">${c.payment_date||'—'}</td>
      <td><div class="client-name" style="font-size:13px">${c.business}</div></td>
      <td style="font-size:13px">${c.owner}</td>
      <td><span class="badge badge-${c.plan}">${c.plan_label||c.plan}</span></td>
      <td style="font-weight:700;color:var(--green)">₹${(c.payment_amount||0).toLocaleString('en-IN')}</td>
      <td style="font-size:12px;color:var(--muted)">${c.payment_ref||'—'}</td>
      <td><span class="badge badge-${c.payment_status}">${c.payment_status==='paid'?'✅ Paid':'⏳ Pending'}</span></td>
    </tr>`).join('');
}

// ── HELPERS ────────────────────────────────────────────────────────
function statusLabel(s) {
  const map = { new:'🆕 New', setup_in_progress:'⚙️ Setting Up', active:'✅ Active', paused:'⏸ Paused', cancelled:'❌ Cancelled' };
  return map[s]||s;
}
function sendWA(id) {
  const c = clients.find(x => x.id===id);
  if (!c) return;
  const msg = encodeURIComponent(`Hi ${c.owner}! This is Anuragini from AutoGreet. I'm reaching out regarding your ${c.plan} setup for ${c.business}. 🚀`);
  window.open(`https://wa.me/91${c.phone}?text=${msg}`,'_blank');
}
async function deleteClient(id) {
  if (!confirm('Delete this client? This cannot be undone.')) return;
  clients = clients.filter(c => c.id !== id);
  saveClients(); renderAll();
  try {
    await fetch(API + '/api/clients/' + id, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey() }
    });
  } catch(e) { /* silent */ }
}

// ── DETAIL MODAL ───────────────────────────────────────────────────
function openDetail(id) {
  editingId = id;
  const c = clients.find(x => x.id === id);
  if (!c) return;
  document.getElementById('modal-biz-name').textContent = c.business + ' — ' + c.owner;
  document.getElementById('modal-body').innerHTML = `
    <div class="detail-grid">
      <div class="form-group"><label class="form-label">Status</label>
        <select class="form-input form-select" id="e-status">
          ${['new','setup_in_progress','active','paused','cancelled'].map(s=>`<option value="${s}" ${c.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">Reviews After</label>
        <input class="form-input" id="e-reviews" type="number" value="${c.reviews_after||0}"/></div>
      <div class="form-group"><label class="form-label">Rating Before</label>
        <input class="form-input" id="e-rating-b" type="number" step="0.1" value="${c.google_rating_before||0}"/></div>
      <div class="form-group"><label class="form-label">Rating After</label>
        <input class="form-input" id="e-rating-a" type="number" step="0.1" value="${c.google_rating_after||0}"/></div>
      <div class="form-group"><label class="form-label">Google Review Link</label>
        <input class="form-input" id="e-review-link" value="${c.review_link||''}"/></div>
      <div class="form-group"><label class="form-label">Go-Live Date</label>
        <input class="form-input" type="date" id="e-golive" value="${c.go_live_date||''}"/></div>
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Notes</label>
        <textarea class="form-input" id="e-notes" rows="2">${c.notes||''}</textarea></div>
    </div>
    <div style="padding:14px;background:var(--bg);border-radius:10px;font-size:12px;color:var(--muted);margin-top:4px">
      <strong style="color:var(--text)">Contact:</strong> ${c.phone} | ${c.email||'No email'} &nbsp;|&nbsp;
      <strong style="color:var(--text)">Plan:</strong> ${c.plan_label||c.plan} &nbsp;|&nbsp;
      <strong style="color:var(--text)">Paid:</strong> ₹${(c.payment_amount||0).toLocaleString('en-IN')} on ${c.payment_date||'—'}
    </div>`;
  document.getElementById('detail-modal').classList.add('open');
}
function closeModal() { document.getElementById('detail-modal').classList.remove('open'); }
async function saveClientEdits() {
  const idx = clients.findIndex(c => c.id === editingId);
  if (idx === -1) return;
  const updates = {
    status:               document.getElementById('e-status').value,
    reviews_after:        parseInt(document.getElementById('e-reviews').value)||0,
    google_rating_before: parseFloat(document.getElementById('e-rating-b').value)||0,
    google_rating_after:  parseFloat(document.getElementById('e-rating-a').value)||0,
    review_link:          document.getElementById('e-review-link').value,
    go_live_date:         document.getElementById('e-golive').value,
    notes:                document.getElementById('e-notes').value
  };
  // Optimistic update
  Object.assign(clients[idx], updates);
  saveClients(); renderAll(); closeModal();
  // Persist to backend
  try {
    await fetch(API + '/api/clients/' + editingId, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json', 'x-admin-key': adminKey() },
      body: JSON.stringify(updates)
    });
  } catch(e) { /* silent — local cache already updated */ }
}

// ── ADD CLIENT ─────────────────────────────────────────────────────
async function addClient() {
  const owner = document.getElementById('f-owner').value.trim();
  const biz   = document.getElementById('f-biz').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  if (!owner||!biz||!phone) { showMsg('Please fill Owner Name, Business Name and Phone.','var(--red)'); return; }
  const plan         = document.getElementById('f-plan').value;
  const payment_status = document.getElementById('f-payment').value;
  const payload = {
    owner_name:      owner,
    business_name:   biz,
    business_type:   document.getElementById('f-type').value,
    city:            document.getElementById('f-city').value,
    email:           document.getElementById('f-email').value,
    phone,
    plan,
    payment_status,
    payment_amount:  PLAN_FEES[plan],
    payment_date:    document.getElementById('f-paydate').value,
    payment_ref:     document.getElementById('f-payref').value,
    gmaps_url:       document.getElementById('f-gmaps').value,
    review_link:     document.getElementById('f-review-link').value,
    notes:           document.getElementById('f-notes').value
  };
  showMsg('Saving…','var(--muted)');
  try {
    const res  = await fetch(API + '/api/onboard', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-admin-key': adminKey() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    showMsg('✅ Client added! Refreshing…','var(--green)');
    clearForm();
    await loadClientsFromAPI();
  } catch(e) {
    showMsg('❌ Error: ' + e.message, 'var(--red)');
  }
}
function clearForm() {
  ['f-owner','f-biz','f-city','f-email','f-phone','f-payref','f-gmaps','f-review-link','f-notes']
    .forEach(id => document.getElementById(id).value = id==='f-city'?'Lucknow':'');
  document.getElementById('f-plan').value = 'starter';
  document.getElementById('f-payment').value = 'paid';
  document.getElementById('f-paydate').value = new Date().toISOString().split('T')[0];
}
function showMsg(msg, color) {
  const el = document.getElementById('form-msg');
  el.style.display = 'block';
  el.style.color = color;
  el.textContent = msg;
  setTimeout(() => el.style.display='none', 5000);
}

// ── CHARTS ────────────────────────────────────────────────────────
function buildCharts() {
  const months = ['Oct','Nov','Dec','Jan','Feb','Mar'];
  const monthRevenue = [0,0,0,0,0, clients.reduce((s,c)=>s+(c.payment_amount||0),0)];

  // Revenue trend
  new Chart(document.getElementById('revenueChart'), {
    type:'line',
    data:{ labels:months, datasets:[{ label:'Revenue (₹)', data:monthRevenue,
      borderColor:'#25D366', backgroundColor:'rgba(37,211,102,.1)',
      tension:.4, fill:true, pointBackgroundColor:'#25D366' }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{ x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#94A3B8'}},
               y:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#94A3B8',callback:v=>'₹'+v}} } }
  });

  // Plan distribution donut
  const planCounts = {starter:0,growth:0,authority:0};
  clients.forEach(c => planCounts[c.plan]=(planCounts[c.plan]||0)+1);
  new Chart(document.getElementById('planChart'), {
    type:'doughnut',
    data:{ labels:['Starter','Growth','Authority'],
      datasets:[{ data:[planCounts.starter,planCounts.growth,planCounts.authority],
        backgroundColor:['#25D366','#F59E0B','#8B5CF6'],
        borderColor:'#1E293B', borderWidth:3 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{labels:{color:'#E2E8F0',font:{size:12}}} } }
  });

  // Revenue bar
  const ctx3 = document.getElementById('revenueBar');
  if (ctx3) new Chart(ctx3, {
    type:'bar',
    data:{ labels:['Starter Setups','Growth Setups','Authority Setups','Monthly Retainers'],
      datasets:[{ label:'Revenue (₹)',
        data:[
          clients.filter(c=>c.plan==='starter').reduce((s,c)=>s+(c.payment_amount||0),0),
          clients.filter(c=>c.plan==='growth').reduce((s,c)=>s+(c.payment_amount||0),0),
          clients.filter(c=>c.plan==='authority').reduce((s,c)=>s+(c.payment_amount||0),0),
          clients.filter(c=>c.plan!=='starter'&&c.status==='active').reduce((s,c)=>s+PLAN_MRR[c.plan],0)
        ],
        backgroundColor:['rgba(37,211,102,.7)','rgba(245,158,11,.7)','rgba(139,92,246,.7)','rgba(59,130,246,.7)'],
        borderRadius:8 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{ x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#94A3B8'}},
               y:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#94A3B8',callback:v=>'₹'+v}} } }
  });
}

// ── EXPORT CSV ────────────────────────────────────────────────────
function exportRevCSV() {
  const rows = [['Date','Business','Owner','Plan','Amount','Ref','Status']].concat(
    clients.map(c=>[c.payment_date,c.business,c.owner,c.plan,c.payment_amount,c.payment_ref,c.payment_status]));
  const csv = rows.map(r=>r.join(',')).join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'autogreet-revenue.csv'; a.click();
}

// ── AUTO-LOGIN (persistent localStorage session) ────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const saved = localStorage.getItem('ag_admin_key');
  if (saved) {
    try {
      const res = await fetch(API + '/api/clients', { headers: { 'x-admin-key': saved } });
      if (res.ok) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        init();
        return;
      }
    } catch(e) {}
    localStorage.removeItem('ag_admin_key');
  }
});

// ── DEMO LEADS ────────────────────────────────────────────────────
let demoLeads = [];

async function loadDemoLeads() {
  document.getElementById('dl-table').innerHTML =
    '<tr><td colspan="8" class="empty" style="padding:24px"><div class="empty-icon">⏳</div>Loading…</td></tr>';
  try {
    const res  = await fetch(API + '/api/demo-leads', { headers: { 'x-admin-key': adminKey() } });
    const data = await res.json();
    demoLeads  = data.leads || [];
    // Update summary counts
    const summary = data.summary || {};
    document.getElementById('dl-total').textContent     = demoLeads.length;
    document.getElementById('dl-pending').textContent   = summary.demo_pending    || demoLeads.filter(l=>l.status==='demo_pending').length;
    document.getElementById('dl-given').textContent     = summary.demo_given      || demoLeads.filter(l=>l.status==='demo_given').length;
    document.getElementById('dl-onboarded').textContent = summary.client_onboarded|| demoLeads.filter(l=>l.status==='client_onboarded').length;
    renderDemoLeads();
  } catch(e) {
    document.getElementById('dl-table').innerHTML =
      '<tr><td colspan="8" class="empty"><div class="empty-icon">⚠️</div>Error loading leads. Check API connection.</td></tr>';
  }
}

function renderDemoLeads() {
  const filter = document.getElementById('dl-filter')?.value || '';
  const list   = filter ? demoLeads.filter(l => l.status === filter) : demoLeads;
  const tbody  = document.getElementById('dl-table');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty"><div class="empty-icon">📭</div>No leads found.</td></tr>';
    return;
  }
  const statusLabel = { demo_pending:'⏳ Pending', demo_given:'✅ Demo Given', not_interested:'❌ Not Interested', client_onboarded:'🎉 Onboarded' };
  const statusBadge = { demo_pending:'badge-pending', demo_given:'badge-active', not_interested:'badge-new', client_onboarded:'badge-completed' };
  tbody.innerHTML = list.map((l,i) => `
    <tr>
      <td style="color:var(--muted)">${i+1}</td>
      <td><div class="client-name">${escHtml(l.name||'')}</div></td>
      <td><div style="font-size:13px">${escHtml(l.business_name||'')}</div></td>
      <td style="font-size:12px;color:var(--muted)">${escHtml(l.location||'')}</td>
      <td style="font-size:12px">
        ${l.email ? `<div>📧 ${escHtml(l.email)}</div>` : ''}
        ${l.phone ? `<div>📱 ${escHtml(l.phone)}</div>` : ''}
      </td>
      <td>
        <select class="form-input form-select" style="padding:5px 28px 5px 8px;font-size:12px;border-radius:6px"
          onchange="updateLeadStatus(${l.id}, this.value)">
          ${['demo_pending','demo_given','not_interested','client_onboarded'].map(s =>
            `<option value="${s}" ${l.status===s?'selected':''}>${statusLabel[s]||s}</option>`
          ).join('')}
        </select>
      </td>
      <td style="font-size:12px;color:var(--muted)">${l.created_at ? new Date(l.created_at).toLocaleDateString('en-IN') : '—'}</td>
      <td>
        <div class="action-row">
          ${l.phone ? `<button class="act-btn" onclick="window.open('https://wa.me/91${l.phone.replace(/\D/g,'')}','_blank')">💬 WA</button>` : ''}
          ${l.email ? `<button class="act-btn" onclick="window.open('mailto:${escHtml(l.email)}')">📧 Mail</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

async function updateLeadStatus(id, status) {
  try {
    await fetch(API + '/api/demo-leads/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json', 'x-admin-key': adminKey() },
      body: JSON.stringify({ status })
    });
    const lead = demoLeads.find(l => l.id === id);
    if (lead) {
      lead.status = status;
      // Update summary counts
      document.getElementById('dl-pending').textContent   = demoLeads.filter(l=>l.status==='demo_pending').length;
      document.getElementById('dl-given').textContent     = demoLeads.filter(l=>l.status==='demo_given').length;
      document.getElementById('dl-onboarded').textContent = demoLeads.filter(l=>l.status==='client_onboarded').length;
    }
  } catch(e) { alert('Failed to update status. Please try again.'); }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}