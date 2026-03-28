// ══════════════════════════════════════════════════════════════
//  AutoGreet Backend — server.js
//  Handles: customer webhooks → n8n, client onboarding, CSV upload
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const multer   = require('multer');
const XLSX     = require('xlsx');
const fs       = require('fs-extra');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

const upload = multer({ dest: 'uploads/' });

// ── Data file paths ────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const LOG_FILE     = path.join(DATA_DIR, 'send_log.json');

fs.ensureDirSync(DATA_DIR);
if (!fs.existsSync(CLIENTS_FILE)) fs.writeJsonSync(CLIENTS_FILE, []);
if (!fs.existsSync(LOG_FILE))     fs.writeJsonSync(LOG_FILE, []);

// ── Helpers ────────────────────────────────────────────────────
function readJson(file)       { return fs.readJsonSync(file, { throws: false }) || []; }
function writeJson(file, data){ fs.writeJsonSync(file, data, { spaces: 2 }); }

async function triggerN8n(payload) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return { ok: false, error: 'N8N_WEBHOOK_URL not set in .env' };
  try {
    await axios.post(url, payload, { timeout: 8000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildWhatsAppMessage(customerName, businessName, reviewLink) {
  return `Hi ${customerName}! 👋

Thank you for visiting ${businessName} today!

We hope you had a wonderful experience. If you enjoyed your visit, we'd love it if you could take 30 seconds to leave us a Google review — it helps us serve you better! 🌟

👉 ${reviewLink || '[Review Link]'}

Thank you so much! 🙏
— Team ${businessName}`;
}

// ══════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'AutoGreet API', timestamp: new Date().toISOString() });
});

// ── 1. SEND SINGLE REVIEW REQUEST ─────────────────────────────
// POST /api/send-request
// Body: { customer_name, phone, email, business, review_link, delay_hours }
app.post('/api/send-request', async (req, res) => {
  const { customer_name, phone, email, business, review_link, delay_hours = 3 } = req.body;
  if (!customer_name || !phone || !business) {
    return res.status(400).json({ error: 'customer_name, phone, and business are required' });
  }
  const payload = {
    customer_name, phone, email: email || '',
    business, review_link: review_link || '',
    message: buildWhatsAppMessage(customer_name, business, review_link),
    delay_hours: Number(delay_hours),
    trigger: 'api_single',
    source: 'autogreet_backend',
    timestamp: new Date().toISOString()
  };
  const result = await triggerN8n(payload);
  // Log it
  const logs = readJson(LOG_FILE);
  logs.unshift({ ...payload, webhook_ok: result.ok, logged_at: new Date().toISOString() });
  writeJson(LOG_FILE, logs.slice(0, 1000)); // keep last 1000
  if (result.ok) {
    res.json({ success: true, message: 'Review request queued', payload });
  } else {
    res.status(500).json({ success: false, error: result.error, payload });
  }
});

// ── 2. BULK UPLOAD (CSV / XLSX) ───────────────────────────────
// POST /api/bulk-upload  (multipart/form-data, field: file)
app.post('/api/bulk-upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { business, review_link, delay_hours = 3 } = req.body;
  try {
    const wb   = XLSX.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);
    fs.removeSync(req.file.path);
    const customers = rows
      .map(r => ({ name: r[0], type: r[1], phone: r[2] ? String(r[2]) : '', email: r[3] || '', priority: r[5] || 'Low', address: r[6] || '' }))
      .filter(c => c.name && c.phone);
    const results = [];
    for (const c of customers) {
      const payload = {
        customer_name: c.name, phone: c.phone, email: c.email,
        business: business || 'AutoGreet Business', review_link: review_link || '',
        message: buildWhatsAppMessage(c.name, business || 'AutoGreet Business', review_link),
        delay_hours: Number(delay_hours), trigger: 'bulk_upload',
        source: 'autogreet_backend', timestamp: new Date().toISOString()
      };
      const r = await triggerN8n(payload);
      results.push({ name: c.name, phone: c.phone, ok: r.ok });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const logs = readJson(LOG_FILE);
    results.forEach(r => logs.unshift({ ...r, business, logged_at: new Date().toISOString() }));
    writeJson(LOG_FILE, logs.slice(0, 1000));
    res.json({ success: true, total: customers.length, sent: results.filter(r => r.ok).length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3. CLIENT ONBOARDING ──────────────────────────────────────
// POST /api/onboard
app.post('/api/onboard', async (req, res) => {
  const clients = readJson(CLIENTS_FILE);
  const client  = {
    id: Date.now(),
    ...req.body,
    status: 'new',
    created_at: new Date().toISOString()
  };
  clients.unshift(client);
  writeJson(CLIENTS_FILE, clients);
  // Notify via n8n (onboarding webhook)
  const notifyUrl = process.env.N8N_ONBOARD_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
  if (notifyUrl) {
    axios.post(notifyUrl, { ...client, trigger: 'new_client_onboard' }).catch(() => {});
  }
  res.json({ success: true, client_id: client.id, message: 'Onboarding received' });
});

// ── 4. GET CLIENTS (admin) ────────────────────────────────────
app.get('/api/clients', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  res.json(readJson(CLIENTS_FILE));
});

// ── 5. GET SEND LOG (admin) ───────────────────────────────────
app.get('/api/logs', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const logs = readJson(LOG_FILE);
  res.json({ total: logs.length, logs: logs.slice(0, 100) });
});

// ── 6. UPDATE CLIENT STATUS (admin) ──────────────────────────
app.patch('/api/clients/:id', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const clients = readJson(CLIENTS_FILE);
  const idx = clients.findIndex(c => c.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  clients[idx] = { ...clients[idx], ...req.body, updated_at: new Date().toISOString() };
  writeJson(CLIENTS_FILE, clients);
  res.json({ success: true, client: clients[idx] });
});

// ── Catch-all: serve frontend ─────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ AutoGreet Backend running on http://localhost:${PORT}`);
  console.log(`   N8N Webhook: ${process.env.N8N_WEBHOOK_URL || '⚠️  Not set — add to .env'}`);
  console.log(`   Admin Key:   ${process.env.ADMIN_KEY ? '✓ Set' : '⚠️  Not set'}\n`);
});

module.exports = app;
