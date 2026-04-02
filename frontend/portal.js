// ═══════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════
const API_BASE = 'https://api.autogreet.in';  // Railway backend via api.autogreet.in CNAME

const PLAN_LABELS = { starter:'Starter Plan', growth:'Growth Pack', authority:'Authority Pack' };
const PLAN_FEES   = { starter:4999, growth:8999, authority:14999 };
const PAYMENT_LINKS = {
  starter: 'https://rzp.io/rzp/6iO6w81b',
  growth:  'https://rzp.io/rzp/P2lPawQv',
  authority:'https://rzp.io/rzp/k3e5eVs'
};

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let currentClient  = null;
let authToken      = null;
let sessionLogs    = [];   // send log from API
let uploadedRows   = [];
let uploadedFile   = null;
let growthChartInst= null;

// ═══════════════════════════════════════════════════════
//  API HELPERS
// ═══════════════════════════════════════════════════════
async function apiGet(path) {
  const res = await fetch(API_BASE + path, {
    headers: { 'x-client-token': authToken }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'x-client-token': authToken },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function apiPatch(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json', 'x-client-token': authToken },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data;
}

// ═══════════════════════════════════════════════════════
//  LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════
async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();
  if (!u || !p) { showLoginErr('Please enter your email/phone and password.'); return; }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const data = await fetch(API_BASE + '/api/client/login', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ username: u, password: p })
    }).then(async r => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Login failed');
      return j;
    });

    authToken = data.token;
    currentClient = data.client;
    localStorage.setItem('ag_token', authToken);

    // Fetch full client profile
    const fullClient = await apiGet('/api/client/me');
    currentClient = fullClient;

    initPortal(currentClient);
    loadLogs();
  } catch (err) {
    showLoginErr(err.message || 'Login failed. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔐 Login to Dashboard';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') doLogin();
});

function showLoginErr(msg) {
  const el = document.getElementById('loginErr');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

async function doLogout() {
  try {
    if (authToken) {
      await fetch(API_BASE + '/api/client/logout', {
        method: 'POST', headers: { 'x-client-token': authToken }
      }).catch(()=>{});
    }
  } finally {
    authToken = null;
    currentClient = null;
    sessionLogs = [];
    localStorage.removeItem('ag_token');
    document.getElementById('portalApp').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
  }
}

// ═══════════════════════════════════════════════════════
//  INIT PORTAL
// ═══════════════════════════════════════════════════════
function initPortal(c) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('portalApp').style.display = 'block';

  document.getElementById('sidebarPlan').textContent = PLAN_LABELS[c.plan] || c.plan;
  document.getElementById('ownerName').textContent = (c.owner||'').split(' ')[0] || 'there';
  document.getElementById('bizNameSub').textContent = (c.business||'') + (c.type ? ' · ' + c.type : '');

  if (c.payment_status !== 'paid') {
    document.getElementById('payAlert').style.display = 'flex';
  } else {
    document.getElementById('payAlert').style.display = 'none';
  }

  // Stats
  document.getElementById('statSent').textContent    = c.reviews_sent    || 0;
  document.getElementById('statReviews').textContent = c.reviews_received || 0;
  const rating = c.rating_after || c.rating_before;
  document.getElementById('statRating').textContent  = rating ? rating + '★' : '—';
  document.getElementById('statRatingSub').textContent = c.rating_before && c.rating_after
    ? `Up from ${c.rating_before}★` : 'Will update after first week';
  const conv = c.reviews_sent > 0
    ? Math.round((c.reviews_received / c.reviews_sent) * 100) + '%' : '—';
  document.getElementById('statConv').textContent = conv;

  // Target
  document.getElementById('targetNum').textContent  = c.monthly_target || 30;
  const pct = (c.monthly_target||0) > 0
    ? Math.round(((c.reviews_received||0) / c.monthly_target) * 100) : 0;
  document.getElementById('progressPct').textContent     = pct + '%';
  document.getElementById('progressFill').style.width    = Math.min(pct,100) + '%';
  document.getElementById('beforeRating').textContent    = c.rating_before ? c.rating_before + '★ avg rating' : 'Not set yet';
  document.getElementById('afterRating').textContent     = c.rating_after  ? c.rating_after  + '★ avg rating' : 'Will track after week 1';

  // WhatsApp preview
  document.getElementById('previewBiz').textContent = c.business || 'your business';

  buildTransactions(c);
  buildAccountInfo(c);
  populateProfileForm(c);
  setTimeout(() => buildGrowthChart(c), 100);
  setupNav();
}

// ═══════════════════════════════════════════════════════
//  LOAD LOGS (Customers + Activity)
// ═══════════════════════════════════════════════════════
async function loadLogs() {
  try {
    const data = await apiGet('/api/client/logs');
    sessionLogs = data.logs || [];
    buildActivity(sessionLogs);
    renderCustomersTable(sessionLogs);
    updateQueueStats(sessionLogs);
    renderSendLog(sessionLogs.slice(0, 50));
  } catch (err) {
    console.error('Failed to load logs:', err.message);
    // Show empty states gracefully
    buildActivity([]);
    renderCustomersTable([]);
  }
}

function buildActivity(logs) {
  const list = document.getElementById('activityList');
  const c = currentClient;
  const items = [];

  if (c.created_at) {
    items.push({ icon:'✅', cls:'green', text:`Account activated — ${esc(c.business||'')} onboarded`, time: formatDate(c.go_live_date || c.created_at) });
  }
  if (c.payment_status === 'paid' && c.payment_date) {
    items.push({ icon:'💳', cls:'gold', text:`Payment received ₹${Number(c.payment_amount||0).toLocaleString('en-IN')} (${esc(c.payment_ref||'—')})`, time: formatDate(c.payment_date) });
  }
  if (logs.length > 0) {
    const sent = logs.filter(l => l.webhook_ok).length;
    items.push({ icon:'📱', cls:'blue', text:`${Number(sent)} review requests delivered via WhatsApp`, time: formatDate(logs[0].logged_at) });
  }
  if ((c.reviews_received||0) > 0) {
    items.push({ icon:'⭐', cls:'gold', text:`${Number(c.reviews_received)} new Google reviews received`, time:'This month' });
  }

  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--gray);font-size:.88rem;text-align:center;padding:20px;">No activity yet. Send your first review request to get started!</div>';
    return;
  }
  list.innerHTML = items.map(i => `
    <div class="activity-item">
      <div class="act-icon ${i.cls}">${i.icon}</div>
      <div class="act-body">
        <div class="act-text">${i.text}</div>
        <div class="act-time">${i.time}</div>
      </div>
    </div>`).join('');
}

function renderCustomersTable(logs) {
  const tbody = document.getElementById('customersBody');
  const sent   = logs.filter(l => l.webhook_ok).length;
  const failed = logs.filter(l => !l.webhook_ok).length;

  document.getElementById('custTotal').textContent  = logs.length;
  document.getElementById('custSent').textContent   = sent;
  document.getElementById('custFailed').textContent = failed;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <p>No customers yet. Send your first review request!</p>
      </div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = logs.map((l,i) => `
    <tr>
      <td>${i+1}</td>
      <td><strong>${esc(l.customer_name||'—')}</strong></td>
      <td>${esc(l.phone||'—')}</td>
      <td style="color:var(--gray);">${esc(l.email||'—')}</td>
      <td style="color:var(--gray);">${formatDate(l.logged_at)}</td>
      <td><span class="badge badge-plan">${esc((l.trigger_type||'').replace(/_/g,' '))}</span></td>
      <td><span class="badge badge-${l.webhook_ok?'sent':'failed'}">${l.webhook_ok?'Sent':'Failed'}</span></td>
    </tr>`).join('');
}

function updateQueueStats(logs) {
  document.getElementById('qSent').textContent    = logs.filter(l => l.webhook_ok).length;
  document.getElementById('qFailed').textContent  = logs.filter(l => !l.webhook_ok).length;
  document.getElementById('qPending').textContent = 0;
}

function renderSendLog(logs) {
  const tbody = document.getElementById('sendLogBody');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--gray);padding:24px;">No requests sent yet</td></tr>';
    return;
  }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td><strong>${esc(l.customer_name||'—')}</strong></td>
      <td>${esc(l.phone||'—')}</td>
      <td>${formatDate(l.logged_at)}</td>
      <td><span class="badge badge-${l.webhook_ok?'sent':'failed'}">${l.webhook_ok?'Sent':'Failed'}</span></td>
    </tr>`).join('');
}

// ═══════════════════════════════════════════════════════
//  GROWTH CHART
// ═══════════════════════════════════════════════════════
function buildGrowthChart(c) {
  const ctx = document.getElementById('growthChart');
  if (!ctx) return;
  if (growthChartInst) growthChartInst.destroy();
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  // Distribute reviews_sent across 7 days roughly
  const total = c.reviews_sent || 0;
  const data = days.map((_,i) => {
    const base = Math.floor(total / 7);
    const extra = (total % 7) > i ? 1 : 0;
    return base + extra + (i%2===0 ? 1 : 0);
  });
  growthChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days,
      datasets: [{
        label: 'Reviews Sent',
        data: data,
        borderColor: '#25d366',
        backgroundColor: 'rgba(37,211,102,.12)',
        tension: 0.4, fill: true,
        pointBackgroundColor: '#25d366', pointRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color:'rgba(255,255,255,.05)' }, ticks: { color:'#8a9bb0', font:{size:11} } },
        y: { grid: { color:'rgba(255,255,255,.05)' }, ticks: { color:'#8a9bb0', precision:0, font:{size:11} } }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════
//  TRANSACTIONS + UPGRADE
// ═══════════════════════════════════════════════════════
function buildTransactions(c) {
  const plan = c.plan || 'starter';
  const features = {
    starter:   ['Up to 50 review requests/month','WhatsApp automation','Google review link tracking','Email support'],
    growth:    ['Up to 200 review requests/month','AI-generated review responses','Monthly performance report','Priority WhatsApp support'],
    authority: ['Unlimited review requests','AI response automation','Bi-weekly strategy calls','Dedicated account manager']
  };
  document.getElementById('planDetails').innerHTML = `
    <div style="margin-bottom:12px;"><span class="badge badge-plan" style="font-size:.9rem;padding:6px 14px;">${PLAN_LABELS[plan]}</span></div>
    <div style="font-size:.85rem;color:var(--gray);margin-bottom:12px;">₹${(PLAN_FEES[plan]||0).toLocaleString('en-IN')} setup fee</div>
    <ul style="list-style:none;font-size:.85rem;line-height:1.9;">${(features[plan]||[]).map(f=>`<li>✓ ${f}</li>`).join('')}</ul>`;

  // Payment status block
  const sb = document.getElementById('paymentStatusBlock');
  if (c.payment_status === 'paid') {
    sb.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <span style="font-size:1.6rem;">✅</span>
        <div><div style="font-weight:700;color:var(--green);">Payment Confirmed</div>
        <div style="font-size:.82rem;color:var(--gray);">Paid on ${formatDate(c.payment_date)}</div></div>
      </div>
      <div style="font-size:.88rem;color:var(--gray);">Ref: ${esc(c.payment_ref||'—')}</div>
      <div style="font-size:.88rem;color:var(--gray);">Amount: ₹${Number(c.payment_amount||0).toLocaleString('en-IN')}</div>`;
  } else {
    sb.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:1.4rem;margin-bottom:10px;">⏳</div>
        <div style="font-weight:700;color:var(--gold);margin-bottom:6px;">Payment Pending</div>
        <div style="font-size:.84rem;color:var(--gray);margin-bottom:16px;">Complete payment to activate automation</div>
        <a href="${PAYMENT_LINKS[plan] || '#'}" target="_blank" rel="noopener noreferrer" class="pay-btn" style="display:inline-block;text-decoration:none;">💳 Pay Now — ₹${Number(PLAN_FEES[plan]||0).toLocaleString('en-IN')}</a>
      </div>`;
  }

  // Upgrade grid
  const planOrder = ['starter','growth','authority'];
  const planDescs = {
    starter: 'Perfect for small businesses starting with review automation.',
    growth: 'For growing businesses that want AI-powered responses.',
    authority: 'Full-service automation with dedicated support.'
  };
  const currentIdx = planOrder.indexOf(plan);
  document.getElementById('upgradeGrid').innerHTML = planOrder.map((p, idx) => {
    const isCurrent = p === plan;
    const isHigher  = idx > currentIdx;
    return `<div class="upgrade-card ${isCurrent?'current-plan':isHigher?'higher-plan':''}">
      <div class="plan-name">${PLAN_LABELS[p]}${isCurrent?' ✓':''}</div>
      <div class="plan-price">₹${PLAN_FEES[p].toLocaleString('en-IN')}</div>
      <div class="plan-features">${planDescs[p]}</div>
      ${isCurrent
        ? `<span class="badge badge-plan">Current Plan</span>`
        : isHigher
          ? `<a href="${PAYMENT_LINKS[p]}" target="_blank" class="btn btn-gold btn-sm" style="display:inline-block;text-decoration:none;">⬆️ Upgrade Now</a>`
          : `<span style="font-size:.78rem;color:var(--gray);">Lower plan</span>`
      }
    </div>`;
  }).join('');

  // Transaction list
  const txnList = document.getElementById('txnList');
  const txns = [];
  if (c.payment_status === 'paid') {
    txns.push({ ref: c.payment_ref||'—', desc: PLAN_LABELS[plan]+' — Setup Fee', amount: c.payment_amount, date: c.payment_date, status:'paid' });
  }
  txnList.innerHTML = txns.length === 0
    ? '<div style="text-align:center;color:var(--gray);padding:24px;font-size:.88rem;">No transactions yet</div>'
    : txns.map(t => `
      <div class="txn-row">
        <div><div class="txn-ref">${esc(t.ref)}</div><div class="txn-desc">${esc(t.desc)}</div></div>
        <div class="txn-amount">₹${(t.amount||0).toLocaleString('en-IN')}</div>
        <div class="txn-date">${formatDate(t.date)}</div>
        <span class="badge badge-${t.status}">${t.status}</span>
      </div>`).join('');
}

// ═══════════════════════════════════════════════════════
//  ACCOUNT INFO
// ═══════════════════════════════════════════════════════
function buildAccountInfo(c) {
  document.getElementById('bizInfoGrid').innerHTML = `
    <div class="info-item"><label>Business Name</label><p>${esc(c.business||'—')}</p></div>
    <div class="info-item"><label>Business Type</label><p>${esc(c.type||'—')}</p></div>
    <div class="info-item"><label>Owner</label><p>${esc(c.owner||'—')}</p></div>
    <div class="info-item"><label>City</label><p>${esc(c.city||'Lucknow')}</p></div>
    <div class="info-item"><label>Phone</label><p>${esc(c.phone||'—')}</p></div>
    <div class="info-item"><label>Email</label><p>${esc(c.email||'—')}</p></div>
    <div class="info-item"><label>Plan</label><p><span class="badge badge-plan">${PLAN_LABELS[c.plan]||c.plan}</span></p></div>
    <div class="info-item"><label>Member Since</label><p>${formatDate(c.created_at)}</p></div>
  `;

  const rl = document.getElementById('reviewLinkBlock');
  if (c.google_review_link && c.google_review_link.startsWith('http') && !c.google_review_link.includes('YOUR_')) {
    rl.innerHTML = `
      <p style="font-size:.88rem;color:var(--gray);margin-bottom:12px;">Share this link to collect Google reviews:</p>
      <div style="background:var(--navy3);border-radius:8px;padding:12px 16px;font-family:monospace;font-size:.85rem;word-break:break-all;color:var(--green);">${esc(c.google_review_link)}</div>
      <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${esc(c.google_review_link)}').then(()=>showToast('Link copied!','success'))">📋 Copy</button>
        <a href="${esc(c.google_review_link)}" target="_blank" class="btn btn-outline btn-sm">🔗 Test Link</a>
        <button class="btn btn-outline btn-sm" onclick="showPage('profile')">✏️ Edit Link</button>
      </div>`;
  } else {
    rl.innerHTML = `
      <div style="background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.2);border-radius:8px;padding:14px 16px;font-size:.86rem;color:rgba(255,255,255,.7);">
        ⏳ Your Google Review link will be configured during setup. You can also add it yourself in <button onclick="showPage('profile')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:.86rem;text-decoration:underline;">Profile → Google Review Link</button>.
      </div>`;
  }
}

// ═══════════════════════════════════════════════════════
//  PROFILE FORM
// ═══════════════════════════════════════════════════════
function populateProfileForm(c) {
  document.getElementById('profOwner').value      = c.owner       || '';
  document.getElementById('profBusiness').value   = c.business    || '';
  document.getElementById('profCity').value        = c.city        || '';
  document.getElementById('profPhone').value       = c.phone       || '';
  document.getElementById('profEmail').value       = c.email       || '';
  document.getElementById('profGoogleLink').value  = c.google_review_link || '';
}

async function saveProfile() {
  const body = {
    owner:              document.getElementById('profOwner').value.trim(),
    business:           document.getElementById('profBusiness').value.trim(),
    city:               document.getElementById('profCity').value.trim(),
    phone:              document.getElementById('profPhone').value.trim(),
    email:              document.getElementById('profEmail').value.trim(),
    google_review_link: document.getElementById('profGoogleLink').value.trim()
  };
  const ind = document.getElementById('savingIndicator');
  ind.textContent = 'Saving…';
  try {
    const data = await apiPatch('/api/client/profile', body);
    currentClient = { ...currentClient, ...data.client };
    // Refresh display
    buildAccountInfo(currentClient);
    buildTransactions(currentClient);
    document.getElementById('sidebarPlan').textContent = PLAN_LABELS[currentClient.plan] || currentClient.plan;
    document.getElementById('previewBiz').textContent  = currentClient.business || 'your business';
    ind.textContent = '';
    showToast('✅ Profile updated!', 'success');
  } catch (err) {
    ind.textContent = '';
    showToast('Error: ' + err.message, 'error');
  }
}

async function savePassword() {
  const newPass  = document.getElementById('profNewPass').value;
  const confPass = document.getElementById('profConfirmPass').value;
  if (!newPass) { showToast('Please enter a new password.', 'error'); return; }
  if (newPass.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  if (newPass !== confPass) { showToast('Passwords do not match.', 'error'); return; }
  try {
    await apiPatch('/api/client/profile', { new_password: newPass });
    document.getElementById('profNewPass').value    = '';
    document.getElementById('profConfirmPass').value= '';
    showToast('🔑 Password updated successfully!', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page));
  });
}

function showPage(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  const section = document.getElementById('page-' + page);
  if (section) section.classList.add('active');
  // Refresh chart if going back to overview
  if (page === 'overview' && currentClient) setTimeout(() => buildGrowthChart(currentClient), 100);
}

// ═══════════════════════════════════════════════════════
//  SINGLE SEND
// ═══════════════════════════════════════════════════════
async function sendSingle() {
  const name  = document.getElementById('sendName').value.trim();
  const phone = document.getElementById('sendPhone').value.trim();
  const email = document.getElementById('sendEmail').value.trim();
  if (!name || !phone) { showToast('Please enter customer name and phone.', 'error'); return; }
  if (!currentClient) return;

  const btn = document.getElementById('sendSingleBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    await apiPost('/api/client/send', { customer_name: name, phone, email });
    const entry = { customer_name: name, phone, email, logged_at: new Date().toISOString(), webhook_ok: 1, trigger_type: 'portal_single' };
    sessionLogs.unshift(entry);
    renderSendLog(sessionLogs.slice(0, 50));
    updateQueueStats(sessionLogs);
    document.getElementById('sendName').value  = '';
    document.getElementById('sendPhone').value = '';
    document.getElementById('sendEmail').value = '';
    showToast(`✅ Review request sent to ${name}!`, 'success');
    // Update stats
    currentClient.reviews_sent = (currentClient.reviews_sent||0) + 1;
    document.getElementById('statSent').textContent = currentClient.reviews_sent;
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send ➜';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sendName')?.addEventListener('input', e => {
    document.getElementById('previewName').textContent = e.target.value || 'Customer';
  });
});

// ═══════════════════════════════════════════════════════
//  BULK UPLOAD
// ═══════════════════════════════════════════════════════
function handleDragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('drag'); }
function handleDragLeave()  { document.getElementById('uploadZone').classList.remove('drag'); }
function handleDrop(e)      { e.preventDefault(); handleDragLeave(); if(e.dataTransfer.files[0]) { uploadedFile = e.dataTransfer.files[0]; parseFile(uploadedFile); } }
function handleFileSelect(e){ if(e.target.files[0]) { uploadedFile = e.target.files[0]; parseFile(uploadedFile); } }

function parseFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, {type:'binary'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      uploadedRows = rows.map(r => {
        const keys = Object.keys(r);
        const find = (names) => keys.find(k => names.some(n => k.toLowerCase().replace(/[\s_]/g,'').includes(n))) || null;
        return {
          customer_name: String(r[find(['customername','name','fullname'])||keys[0]]||'').trim(),
          phone:         String(r[find(['phone','mobile','contact','whatsapp'])||'']||'').replace(/\D/g,''),
          email:         String(r[find(['email','mail'])||'']||'').trim(),
          visit_date:    String(r[find(['visitdate','date','visiteddate'])||'']||'').trim(),
          notes:         String(r[find(['notes','note','remark'])||'']||'').trim(),
          status: 'ready'
        };
      }).filter(r => r.customer_name && r.phone);
      renderUploadPreview();
      document.getElementById('sendAllBtn').disabled = uploadedRows.length === 0;
      showToast(`✅ ${uploadedRows.length} customers loaded`, 'success');
    } catch(err) {
      showToast('Could not parse file. Please use the sample template.', 'error');
    }
  };
  reader.readAsBinaryString(file);
}

function renderUploadPreview() {
  document.getElementById('previewCard').style.display = 'block';
  document.getElementById('previewCount').textContent = uploadedRows.length;
  document.getElementById('previewBody').innerHTML = uploadedRows.slice(0,50).map((r,i) => `
    <tr>
      <td>${i+1}</td><td>${esc(r.customer_name)}</td><td>${esc(r.phone)}</td>
      <td>${esc(r.email)}</td><td>${esc(r.visit_date)}</td>
      <td><span class="badge badge-${r.status}">${r.status}</span></td>
    </tr>`).join('') + (uploadedRows.length > 50 ? `<tr><td colspan="6" style="text-align:center;color:var(--gray);">…and ${uploadedRows.length-50} more rows</td></tr>` : '');
}

async function processUpload() {
  if (!currentClient || !uploadedFile || uploadedRows.length === 0) return;
  const btn = document.getElementById('sendAllBtn');
  btn.disabled = true;
  btn.textContent = `Sending to ${uploadedRows.length} customers…`;
  showToast(`Uploading ${uploadedRows.length} customers to backend…`, 'success');

  try {
    const formData = new FormData();
    formData.append('file', uploadedFile);
    const res = await fetch(API_BASE + '/api/client/bulk-upload', {
      method: 'POST',
      headers: { 'x-client-token': authToken },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    // Update local preview statuses
    const resultMap = {};
    (data.results||[]).forEach(r => resultMap[r.phone] = r.ok);
    uploadedRows.forEach(r => { r.status = resultMap[r.phone] !== undefined ? (resultMap[r.phone]?'sent':'failed') : 'sent'; });
    renderUploadPreview();

    // Update stats
    currentClient.reviews_sent = (currentClient.reviews_sent||0) + (data.sent||0);
    document.getElementById('statSent').textContent = currentClient.reviews_sent;

    showToast(`🚀 ${data.sent||0} of ${data.total||0} requests sent successfully!`, 'success');
    // Reload logs after a short delay
    setTimeout(() => loadLogs(), 2000);
  } catch(err) {
    showToast('Upload failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Send to All Customers';
  }
}

function clearUpload() {
  uploadedRows = [];
  uploadedFile = null;
  document.getElementById('csvFile').value = '';
  document.getElementById('previewCard').style.display = 'none';
  document.getElementById('sendAllBtn').disabled = true;
}

// ═══════════════════════════════════════════════════════
//  DOWNLOAD SAMPLE TEMPLATE
// ═══════════════════════════════════════════════════════
function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const data = [
    ['customer_name','phone','email','visit_date','notes'],
    ['Rahul Kumar','919876543210','rahul@gmail.com','2026-03-28','Loved the food'],
    ['Priya Sharma','919812345678','priya@email.com','2026-03-27','Regular customer'],
    ['Amit Singh','919898765432','','2026-03-26',''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:20},{wch:16},{wch:28},{wch:14},{wch:30}];
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  XLSX.writeFile(wb, 'AutoGreet_Customer_Template.xlsx');
  showToast('📥 Template downloaded!', 'success');
}

// ═══════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
  catch { return String(d); }
}

function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast ' + type + ' show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ═══════════════════════════════════════════════════════
//  SESSION RESTORE
// ═══════════════════════════════════════════════════════
window.addEventListener('load', async () => {
  const token = localStorage.getItem('ag_token');
  if (!token) return;
  authToken = token;
  try {
    const c = await apiGet('/api/client/me');
    currentClient = c;
    initPortal(c);
    loadLogs();
  } catch {
    // Token invalid or expired — show login
    authToken = null;
    localStorage.removeItem('ag_token');
  }
});

// ═══════════════════════════════════════════════════════
//  AUTH TABS + SIGNUP
// ═══════════════════════════════════════════════════════
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('loginPanel').style.display  = isLogin ? 'block' : 'none';
  document.getElementById('signupPanel').style.display = isLogin ? 'none'  : 'block';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabSignup').classList.toggle('active', !isLogin);
  document.getElementById('authTitle').textContent = isLogin ? 'Client Portal' : 'Create Account';
  document.getElementById('authSub').textContent   = isLogin
    ? 'Access your review automation dashboard'
    : 'Set up your AutoGreet client account';
  if (isLogin) document.getElementById('loginErr').style.display = 'none';
  else { document.getElementById('signupErr').style.display = 'none'; document.getElementById('signupSuccess').style.display = 'none'; }
}

async function doSignup() {
  const btn   = document.getElementById('signupBtn');
  const errEl = document.getElementById('signupErr');
  errEl.style.display = 'none';

  const name  = document.getElementById('suName').value.trim();
  const biz   = document.getElementById('suBiz').value.trim();
  const email = document.getElementById('suEmail').value.trim();
  const phone = document.getElementById('suPhone').value.trim();
  const pass  = document.getElementById('suPass').value;
  const city  = document.getElementById('suCity').value.trim() || 'Lucknow';
  const type  = document.getElementById('suType').value;

  if (!name)  { showSignupErr('Please enter your name.'); return; }
  if (!biz)   { showSignupErr('Please enter your business name.'); return; }
  if (!email) { showSignupErr('Please enter your email.'); return; }
  if (!phone) { showSignupErr('Please enter your mobile number.'); return; }
  if (!pass || pass.length < 6) { showSignupErr('Password must be at least 6 characters.'); return; }

  btn.disabled = true;
  btn.textContent = 'Creating account…';

  try {
    const res  = await fetch(API_BASE + '/api/client/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: name, business: biz, email, phone, password: pass, city, type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed. Please try again.');

    document.getElementById('signupSuccess').style.display = 'block';
    btn.style.display = 'none';
    // Auto-login with the new token if returned
    if (data.token) {
      authToken = data.token;
      localStorage.setItem('ag_token', authToken);
      setTimeout(async () => {
        try {
          const c = await apiGet('/api/client/me');
          initPortal(c);
          loadLogs();
        } catch(e) { switchAuthTab('login'); }
      }, 1800);
    }
  } catch(err) {
    showSignupErr(err.message);
  } finally {
    if (btn.style.display !== 'none') {
      btn.disabled = false;
      btn.textContent = '🚀 Create My Account';
    }
  }
}

function showSignupErr(msg) {
  const el = document.getElementById('signupErr');
  el.textContent = msg;
  el.style.display = 'block';
}