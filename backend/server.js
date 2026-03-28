// ══════════════════════════════════════════════════════════════
//  AutoGreet Backend — server.js
//  MySQL-backed API: client auth, review requests, onboarding
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const multer   = require('multer');
const XLSX     = require('xlsx');
const fs       = require('fs-extra');
const path     = require('path');
const crypto   = require('crypto');
const mysql    = require('mysql2/promise');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','PUT','DELETE'], allowedHeaders: ['Content-Type','x-admin-key','x-client-token'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve frontend only when running locally (not on Railway)
const frontendDir = path.join(__dirname, '../frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
}

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// ── MySQL connection pool ───────────────────────────────────
let db;
async function getDB() {
  if (!db) {
    db = await mysql.createPool({
      host:               process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT)     || 3306,
      database:           process.env.DB_NAME     || 'u719986497_u123456789_aut',
      user:               process.env.DB_USER     || 'anuragini_path',
      password:           process.env.DB_PASS     || '',
      waitForConnections: true,
      connectionLimit:    10,
      connectTimeout:     30000,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });
    console.log('✅ MySQL pool created');
  }
  return db;
}

// ── Helpers ─────────────────────────────────────────────────
const SALT = 'autogreet_salt_2026';
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + SALT).digest('hex');
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function triggerN8n(payload) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url || url.includes('placeholder')) {
    console.warn('⚠️  N8N_WEBHOOK_URL not configured — skipping webhook');
    return { ok: false, error: 'N8N_WEBHOOK_URL not set' };
  }
  try {
    await axios.post(url, payload, { timeout: 10000 });
    return { ok: true };
  } catch (err) {
    console.error('n8n webhook error:', err.message);
    return { ok: false, error: err.message };
  }
}

function buildWhatsAppMessage(customerName, businessName, reviewLink) {
  return `Hi ${customerName}! 👋\n\nThank you for visiting ${businessName} today!\n\nWe hope you had a wonderful experience. If you enjoyed your visit, we'd love it if you could take 30 seconds to leave us a Google review — it helps us serve you better! 🌟\n\n👉 ${reviewLink || '[Review Link]'}\n\nThank you so much! 🙏\n— Team ${businessName}`;
}

// ── Auth helpers ─────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

async function requireClient(req, res, next) {
  const token = req.headers['x-client-token'];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const pool = await getDB();
    const [rows] = await pool.query(
      'SELECT client_id FROM sessions WHERE token = ? AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid or expired session' });
    req.clientId = rows[0].client_id;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed: ' + err.message });
  }
}

// ══════════════════════════════════════════════════════════════
//  ROUTES — PUBLIC
// ══════════════════════════════════════════════════════════════

// Health check
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    const pool = await getDB();
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {}
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    service: 'AutoGreet API',
    db: dbOk ? 'connected' : 'disconnected',
    n8n: process.env.N8N_WEBHOOK_URL ? 'configured' : 'not set',
    timestamp: new Date().toISOString()
  });
});

// ── CLIENT LOGIN ─────────────────────────────────────────────
app.post('/api/client/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const pool = await getDB();
    const u = username.trim().toLowerCase();
    const [rows] = await pool.query(
      'SELECT * FROM clients WHERE LOWER(email) = ? OR phone = ? OR phone = ? LIMIT 1',
      [u, u, u.replace('+91','')]
    );
    if (!rows.length) return res.status(401).json({ error: 'Account not found' });
    const client = rows[0];
    if (!client.password_hash) return res.status(401).json({ error: 'Password not set — contact support on WhatsApp' });
    if (client.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Incorrect password' });

    // Create session
    const token = generateToken();
    await pool.query(
      'INSERT INTO sessions (token, client_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [token, client.id]
    );

    res.json({
      success: true, token,
      client: {
        id: client.id, owner: client.owner, business: client.business,
        type: client.type, plan: client.plan,
        payment_status: client.payment_status, email: client.email
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLIENT LOGOUT ────────────────────────────────────────────
app.post('/api/client/logout', requireClient, async (req, res) => {
  try {
    const pool = await getDB();
    await pool.query('DELETE FROM sessions WHERE token = ?', [req.headers['x-client-token']]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLIENT: GET OWN PROFILE ──────────────────────────────────
app.get('/api/client/me', requireClient, async (req, res) => {
  try {
    const pool = await getDB();
    const [rows] = await pool.query(
      'SELECT id,owner,business,type,city,phone,email,plan,payment_status,payment_amount,payment_date,payment_ref,google_review_link,monthly_target,reviews_sent,reviews_received,rating_before,rating_after,go_live_date,status,notes,created_at FROM clients WHERE id = ?',
      [req.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLIENT: GET OWN LOGS ─────────────────────────────────────
app.get('/api/client/logs', requireClient, async (req, res) => {
  try {
    const pool = await getDB();
    const [rows] = await pool.query(
      'SELECT * FROM send_log WHERE client_id = ? ORDER BY logged_at DESC LIMIT 200',
      [req.clientId]
    );
    res.json({ total: rows.length, logs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLIENT: SEND SINGLE REVIEW REQUEST ───────────────────────
app.post('/api/client/send', requireClient, async (req, res) => {
  const { customer_name, phone, email, delay_hours = 3 } = req.body;
  if (!customer_name || !phone) return res.status(400).json({ error: 'customer_name and phone required' });
  try {
    const pool = await getDB();
    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.clientId]);
    if (!clients.length) return res.status(404).json({ error: 'Client not found' });
    const client = clients[0];
    if (client.payment_status !== 'paid') return res.status(403).json({ error: 'Payment required to send requests' });

    const payload = {
      customer_name, phone, email: email||'',
      business_name: client.business,
      review_link: client.google_review_link || '',
      client_id: req.clientId,
      trigger: 'client_portal_single',
      timestamp: new Date().toISOString()
    };
    const result = await triggerN8n(payload);

    await pool.query(
      'INSERT INTO send_log (client_id, customer_name, phone, email, business, review_link, message_sid, webhook_ok, trigger_type) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.clientId, customer_name, phone, email||'', client.business, client.google_review_link||'', result.sid||null, result.ok?1:0, 'portal_single']
    );
    await pool.query('UPDATE clients SET reviews_sent = reviews_sent + 1 WHERE id = ?', [req.clientId]);

    if (result.ok) res.json({ success: true, message: 'Review request queued' });
    else res.status(500).json({ success: false, error: result.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLIENT: BULK UPLOAD ──────────────────────────────────────
app.post('/api/client/bulk-upload', requireClient, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const pool = await getDB();
    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.clientId]);
    if (!clients.length) return res.status(404).json({ error: 'Client not found' });
    const client = clients[0];
    if (client.payment_status !== 'paid') return res.status(403).json({ error: 'Payment required' });

    const wb   = XLSX.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    fs.removeSync(req.file.path);

    const normalise = (obj) => {
      const keys = Object.keys(obj);
      const find = (names) => keys.find(k => names.some(n => k.toLowerCase().replace(/[\s_]/g,'').includes(n)));
      return {
        customer_name: String(obj[find(['customername','name','fullname'])||keys[0]]||'').trim(),
        phone: String(obj[find(['phone','mobile','contact','whatsapp'])||'']||'').replace(/\D/g,''),
        email: String(obj[find(['email','mail'])||'']||'').trim(),
      };
    };

    const customers = rows.map(normalise).filter(c => c.customer_name && c.phone);
    if (!customers.length) return res.status(400).json({ error: 'No valid rows found. Check column headers match template.' });

    const results = [];
    for (const c of customers) {
      const payload = {
        customer_name: c.customer_name, phone: c.phone, email: c.email,
        business_name: client.business, review_link: client.google_review_link||'',
        client_id: req.clientId, trigger: 'client_portal_bulk'
      };
      const r = await triggerN8n(payload);
      await pool.query(
        'INSERT INTO send_log (client_id, customer_name, phone, email, business, review_link, webhook_ok, trigger_type) VALUES (?,?,?,?,?,?,?,?)',
        [req.clientId, c.customer_name, c.phone, c.email, client.business, client.google_review_link||'', r.ok?1:0, 'portal_bulk']
      );
      results.push({ name: c.customer_name, phone: c.phone, ok: r.ok });
      await new Promise(resolve => setTimeout(resolve, 250)); // throttle
    }
    await pool.query('UPDATE clients SET reviews_sent = reviews_sent + ? WHERE id = ?', [customers.length, req.clientId]);

    res.json({ success: true, total: customers.length, sent: results.filter(r=>r.ok).length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUBLIC: SEND SINGLE (demo / direct) ──────────────────────
app.post('/api/send-request', async (req, res) => {
  const { customer_name, phone, email, business, review_link, delay_hours = 3 } = req.body;
  if (!customer_name || !phone || !business)
    return res.status(400).json({ error: 'customer_name, phone, and business are required' });

  const payload = {
    customer_name, phone, email: email||'', business_name: business,
    review_link: review_link||'',
    message: buildWhatsAppMessage(customer_name, business, review_link),
    delay_hours: Number(delay_hours), trigger: 'api_single',
    timestamp: new Date().toISOString()
  };
  const result = await triggerN8n(payload);

  try {
    const pool = await getDB();
    await pool.query(
      'INSERT INTO send_log (customer_name, phone, email, business, review_link, webhook_ok, trigger_type) VALUES (?,?,?,?,?,?,?)',
      [customer_name, phone, email||'', business, review_link||'', result.ok?1:0, 'api_single']
    );
  } catch {}

  if (result.ok) res.json({ success: true, message: 'Review request queued', payload });
  else res.status(500).json({ success: false, error: result.error });
});

// ── PUBLIC: CLIENT ONBOARDING ─────────────────────────────────
app.post('/api/onboard', async (req, res) => {
  try {
    const pool = await getDB();
    const bizFirst = (req.body.business||'Biz').split(' ')[0];
    const tempPass = bizFirst + '@' + new Date().getFullYear();
    const pwHash   = hashPassword(tempPass);

    const [result] = await pool.query(
      `INSERT INTO clients (owner,business,type,city,phone,email,plan,payment_status,password_hash,status,notes,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        req.body.owner||'', req.body.business||'', req.body.type||'', req.body.city||'Lucknow',
        req.body.phone||'', req.body.email||'', req.body.plan||'starter',
        'pending', pwHash, 'new', req.body.notes||''
      ]
    );

    const notifyUrl = process.env.N8N_ONBOARD_WEBHOOK_URL;
    if (notifyUrl && !notifyUrl.includes('placeholder')) {
      axios.post(notifyUrl, { ...req.body, trigger: 'new_client_onboard', client_id: result.insertId }).catch(()=>{});
    }

    res.json({
      success: true,
      client_id: result.insertId,
      message: 'Onboarding received',
      temp_password: tempPass,
      portal_url: '/portal.html'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  ROUTES — ADMIN
// ══════════════════════════════════════════════════════════════

app.get('/api/clients', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const [rows] = await pool.query('SELECT id,owner,business,type,city,phone,email,plan,payment_status,payment_amount,payment_date,payment_ref,google_review_link,monthly_target,reviews_sent,reviews_received,rating_before,rating_after,status,go_live_date,notes,created_at FROM clients ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const [rows] = await pool.query('SELECT * FROM send_log ORDER BY logged_at DESC LIMIT 200');
    const [cnt]  = await pool.query('SELECT COUNT(*) as total FROM send_log');
    res.json({ total: cnt[0].total, logs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/clients/:id', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const allowed = ['owner','business','type','city','phone','email','plan','payment_status','payment_amount','payment_date','payment_ref','google_review_link','monthly_target','reviews_sent','reviews_received','rating_before','rating_after','status','go_live_date','notes'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (req.body.new_password) {
      updates['password_hash'] = hashPassword(req.body.new_password);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await pool.query(`UPDATE clients SET ${setClauses}, updated_at = NOW() WHERE id = ?`, [...Object.values(updates), req.params.id]);

    const [rows] = await pool.query('SELECT id,owner,business,plan,status,payment_status FROM clients WHERE id = ?', [req.params.id]);
    res.json({ success: true, client: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    await pool.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/set-password', requireAdmin, async (req, res) => {
  const { client_id, new_password } = req.body;
  if (!client_id || !new_password) return res.status(400).json({ error: 'client_id and new_password required' });
  try {
    const pool = await getDB();
    await pool.query('UPDATE clients SET password_hash = ? WHERE id = ?', [hashPassword(new_password), client_id]);
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all ────────────────────────────────────────────────
// Only serve frontend if the file actually exists (won't exist on Railway)
app.get('*', (req, res) => {
  const frontendIndex = path.join(__dirname, '../frontend/index.html');
  if (fs.existsSync(frontendIndex)) {
    res.sendFile(frontendIndex);
  } else {
    res.status(404).json({
      error: 'Not found',
      hint: 'Frontend is served from Hostinger (autogreet.in), not this API server.',
      api_docs: '/api/health'
    });
  }
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n✅ AutoGreet Backend running on port ${PORT}`);
  console.log(`   Environment:  ${process.env.RAILWAY_ENVIRONMENT || 'local'}`);
  console.log(`   N8N Review:   ${process.env.N8N_WEBHOOK_URL || '⚠️  Not set'}`);
  console.log(`   N8N Onboard:  ${process.env.N8N_ONBOARD_WEBHOOK_URL || '⚠️  Not set'}`);
  console.log(`   Admin key:    ${process.env.ADMIN_KEY ? '✓ Set' : '⚠️  Not set'}`);
  console.log(`   DB Host:      ${process.env.DB_HOST || '⚠️  Not set'}`);

  // Test DB connection async — don't block server startup
  setTimeout(async () => {
    try {
      const pool = await getDB();
      await pool.query('SELECT 1');
      console.log(`   MySQL DB:     ✅ Connected → ${process.env.DB_NAME || 'default'}`);
    } catch (e) {
      console.log(`   MySQL DB:     ❌ ${e.message}`);
      console.log(`   → Ensure DB_HOST is the Hostinger external hostname (e.g. srv1234.hstgr.io)`);
      console.log(`   → Enable Remote MySQL in hPanel → Databases → Remote MySQL → add %`);
    }
  }, 2000);

  console.log(`\n   Health check: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
