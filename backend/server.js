// ══════════════════════════════════════════════════════════════
//  AutoGreet Backend — server.js
//  MySQL-backed API: client auth, review requests, onboarding
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const axios        = require('axios');
const multer       = require('multer');
const XLSX         = require('xlsx');
const fs           = require('fs-extra');
const path         = require('path');
const crypto       = require('crypto');
const mysql        = require('mysql2/promise');
const nodemailer   = require('nodemailer');

// ── Email transporter ───────────────────────────────────────
let mailer;
function getMailer() {
  if (!mailer) {
    mailer = nodemailer.createTransport({
      host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '465'),
      secure: (process.env.SMTP_PORT || '465') === '465',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    });
  }
  return mailer;
}

const ADMIN_EMAILS = ['anuragini.pathak@autogreet.in', 'wtaanu@gmail.com'];
const FROM_EMAIL   = '"AutoGreet" <anuragini.pathak@autogreet.in>';

async function sendEmail({ to, subject, html, bcc }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️  SMTP not configured — email not sent:', subject);
    return false;
  }
  try {
    const recipients = Array.isArray(to) ? to.join(',') : to;
    await getMailer().sendMail({ from: FROM_EMAIL, to: recipients, bcc, subject, html });
    console.log('📧 Email sent:', subject, '→', recipients);
    return true;
  } catch (err) {
    console.error('📧 Email error:', err.message);
    return false;
  }
}

function welcomeEmailHtml(owner, business, email, password, plan) {
  const planLabels = { starter:'Starter Plan (₹4,999/mo)', growth:'Growth Pack (₹8,999/mo)', authority:'Authority Pack (₹14,999/mo)' };
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f7f9;padding:20px;">
    <div style="background:#0F2440;border-radius:16px;padding:32px 28px;text-align:center;margin-bottom:20px;">
      <div style="font-size:28px;font-weight:900;color:#fff;margin-bottom:4px;">🎉 Welcome to Auto<span style="color:#25D366">Greet</span>!</div>
      <div style="color:rgba(255,255,255,.65);font-size:14px;">Your AI Review Automation is Active</div>
    </div>
    <div style="background:#fff;border-radius:12px;padding:28px;margin-bottom:16px;">
      <p style="color:#0F2440;font-size:16px;margin-bottom:20px;">Hi <strong>${owner}</strong>,</p>
      <p style="color:#444;line-height:1.6;margin-bottom:20px;">Welcome to AutoGreet! Your account for <strong>${business}</strong> has been created. Here are your login details to access the client dashboard:</p>
      <div style="background:#f0faf4;border:1px solid #25D366;border-radius:10px;padding:18px;margin-bottom:20px;">
        <div style="margin-bottom:10px;"><strong style="color:#0F2440;">🌐 Portal URL:</strong> <a href="https://autogreet.in/portal.html" style="color:#25D366;">https://autogreet.in/portal.html</a></div>
        <div style="margin-bottom:10px;"><strong style="color:#0F2440;">📧 Username:</strong> ${email}</div>
        <div style="margin-bottom:10px;"><strong style="color:#0F2440;">🔑 Password:</strong> <code style="background:#e8f8ee;padding:3px 8px;border-radius:4px;">${password}</code></div>
        <div><strong style="color:#0F2440;">📦 Plan:</strong> ${planLabels[plan] || plan}</div>
      </div>
      <p style="color:#444;font-size:13px;line-height:1.6;">Please change your password after first login. For help, WhatsApp us at <a href="https://wa.me/919250257509" style="color:#25D366;">+91 92502 57509</a></p>
    </div>
    <div style="text-align:center;color:#888;font-size:12px;">AutoGreet · Lucknow, India · autogreet.in</div>
  </div>`;
}

function invoiceEmailHtml(c) {
  const planLabels = { starter:'Starter Plan', growth:'Growth Pack', authority:'Authority Pack' };
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f7f9;padding:20px;">
    <div style="background:#1A1A2E;border-radius:16px;padding:28px;text-align:center;margin-bottom:20px;">
      <div style="font-size:26px;font-weight:900;color:#fff;">Auto<span style="color:#E94560">Greet</span></div>
      <div style="color:rgba(255,255,255,.6);font-size:13px;margin-top:4px;">Tax Invoice / Receipt</div>
    </div>
    <div style="background:#fff;border-radius:12px;padding:28px;margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        <tr><td style="padding:6px 0;color:#666;width:140px;">Invoice No.</td><td style="font-weight:700;">#AG-${String(c.id).padStart(4,'0')}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Date</td><td>${c.payment_date || new Date().toLocaleDateString('en-IN')}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Payment Ref</td><td style="font-family:monospace;">${c.payment_ref || 'MANUAL'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Bill To</td><td><strong>${c.owner}</strong><br>${c.business}${c.city?', '+c.city:''}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#1A1A2E;color:#fff;">
          <th style="padding:10px 14px;text-align:left;">Description</th>
          <th style="padding:10px 14px;text-align:right;">Amount</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;">AutoGreet ${planLabels[c.plan]||c.plan} — Setup Fee</td>
              <td style="padding:12px 14px;text-align:right;border-bottom:1px solid #e5e7eb;">₹${Number(c.payment_amount||0).toLocaleString('en-IN')}</td></tr>
          <tr style="background:#f8f9fa;font-weight:700;">
            <td style="padding:12px 14px;">Total Paid</td>
            <td style="padding:12px 14px;text-align:right;color:#16a34a;font-size:18px;">₹${Number(c.payment_amount||0).toLocaleString('en-IN')}</td>
          </tr>
        </tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:20px;line-height:1.6;">Thank you for choosing AutoGreet! For support, WhatsApp <a href="https://wa.me/919250257509" style="color:#E94560;">+91 92502 57509</a> or email anuragini.pathak@autogreet.in</p>
    </div>
    <div style="text-align:center;color:#888;font-size:12px;">AutoGreet · Lucknow, India · autogreet.in</div>
  </div>`;
}

function adminNotifyHtml(owner, business, email, plan, trigger) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f4f7f9;padding:16px;">
    <div style="background:#0F2440;border-radius:12px;padding:20px;margin-bottom:14px;">
      <strong style="color:#25D366;font-size:16px;">🔔 New AutoGreet ${trigger}</strong>
    </div>
    <div style="background:#fff;border-radius:10px;padding:20px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#666;width:130px;">Name</td><td style="color:#0F2440;font-weight:600;">${owner}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Business</td><td style="color:#0F2440;font-weight:600;">${business}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Email</td><td>${email}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Plan</td><td>${plan}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Time</td><td>${new Date().toLocaleString('en-IN')}</td></tr>
      </table>
      <a href="https://autogreet.in/admin.html" style="display:inline-block;margin-top:16px;background:#25D366;color:#0F2440;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Open Admin Dashboard →</a>
    </div>
  </div>`;
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS allowlist ──────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://autogreet.in',
  'https://www.autogreet.in',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];
app.use(cors({
  origin(origin, cb) {
    // Allow server-to-server (no Origin) or listed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: Origin not allowed — ' + origin));
  },
  methods: ['GET','POST','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','x-admin-key','x-client-token'],
  credentials: false,
}));

// ── Security headers (DAST: X-Frame-Options, HSTS, nosniff, CSP) ─
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('X-XSS-Protection',        '1; mode=block');
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',      'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'");
  // HSTS — only over HTTPS (Railway always TLS)
  if (req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

// ── Rate limiters ───────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts — please wait 15 minutes and try again.' },
  skip: req => process.env.NODE_ENV === 'test',
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hr
  max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many signup attempts — please try again later.' },
});
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many demo requests — please try again later.' },
});
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Rate limit exceeded — slow down.' },
});
app.use(generalLimiter);

// ── Body parsers ────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve frontend only when running locally (not on Railway)
const frontendDir = path.join(__dirname, '../frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir, { dotfiles: 'deny' }));
}

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const allowed = ['.xlsx','.xls','.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only Excel/CSV files are allowed'));
  },
});

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
// PBKDF2 — strong key derivation, no extra npm deps
function hashPassword(pw, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512');
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  // Legacy SHA256 (old clients) — migrate on next login
  if (!stored.includes(':')) {
    const legacy = crypto.createHash('sha256').update(pw + 'autogreet_salt_2026').digest('hex');
    return legacy === stored;
  }
  const [saltHex] = stored.split(':');
  return hashPassword(pw, saltHex) === stored;
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
    const response = await axios.post(url, payload, { timeout: 10000 });
    const sid = response.data?.message_sid || response.data?.sid || null;
    return { ok: true, sid };
  } catch (err) {
    console.error('n8n webhook error:', err.message);
    return { ok: false, error: err.message };
  }
}

function buildWhatsAppMessage(customerName, businessName, reviewLink) {
  return `Hi ${customerName}! 👋\n\nThank you for visiting ${businessName} today!\n\nWe hope you had a wonderful experience. If you enjoyed your visit, we'd love it if you could take 30 seconds to leave us a Google review — it helps us serve you better! 🌟\n\n👉 ${reviewLink || '[Review Link]'}\n\nThank you so much! 🙏\n— Team ${businessName}`;
}

// ── Auth helpers ─────────────────────────────────────────────

// Timing-safe admin key check — prevents timing oracle attacks
function requireAdmin(req, res, next) {
  const provided = req.headers['x-admin-key'] || '';
  const expected = process.env.ADMIN_KEY || '';
  if (!provided || !expected) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // Pad to same length so timingSafeEqual doesn't throw
    const a = Buffer.from(provided.padEnd(expected.length, '\0').slice(0, Math.max(provided.length, expected.length)));
    const b = Buffer.from(expected.padEnd(provided.length,  '\0').slice(0, Math.max(provided.length, expected.length)));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

async function requireClient(req, res, next) {
  const token = req.headers['x-client-token'];
  if (!token || token.length > 128) return res.status(401).json({ error: 'Authentication required' });
  try {
    const pool = await getDB();
    const [rows] = await pool.query(
      'SELECT client_id FROM sessions WHERE token = ? AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(401).json({ error: 'Session expired — please log in again' });
    req.clientId = rows[0].client_id;
    next();
  } catch {
    res.status(500).json({ error: 'Authentication check failed' });
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
app.post('/api/client/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  // Input length guards (SAST: prevent oversized payloads reaching DB)
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (username.length > 200 || password.length > 200) return res.status(400).json({ error: 'Invalid credentials' });
  try {
    const pool = await getDB();
    const u = username.trim().toLowerCase().slice(0, 200);
    const [rows] = await pool.query(
      'SELECT id,owner,business,type,plan,payment_status,email,phone,password_hash FROM clients WHERE LOWER(email) = ? OR phone = ? OR phone = ? LIMIT 1',
      [u, u, u.replace('+91','')]
    );
    // Always run verifyPassword to prevent timing-based user enumeration
    const dummyHash = '0000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const client    = rows[0] || null;
    const valid     = client ? verifyPassword(password, client.password_hash || dummyHash) : verifyPassword(password, dummyHash);
    if (!client || !valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!client.password_hash) return res.status(401).json({ error: 'Password not set — contact support' });

    // Migrate legacy SHA256 → PBKDF2 silently on successful login
    if (!client.password_hash.includes(':')) {
      pool.query('UPDATE clients SET password_hash = ? WHERE id = ?', [hashPassword(password), client.id]).catch(()=>{});
    }

    // Cleanup old sessions for this client (keep DB tidy)
    pool.query('DELETE FROM sessions WHERE client_id = ? AND expires_at < NOW()', [client.id]).catch(()=>{});

    // Create 30-day session
    const token = generateToken();
    await pool.query(
      'INSERT INTO sessions (token, client_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
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
  } catch {
    res.status(500).json({ error: 'Login failed — please try again' });
  }
});

// ── CLIENT LOGOUT ────────────────────────────────────────────
app.post('/api/client/logout', requireClient, async (req, res) => {
  try {
    const pool = await getDB();
    await pool.query('DELETE FROM sessions WHERE token = ?', [req.headers['x-client-token']]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Logout failed' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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

    // ── Dedup: block re-send to same phone within 24 hours ──────
    const cleanPhone = phone.replace(/\D/g, '');
    const [recent] = await pool.query(
      `SELECT id FROM send_log
       WHERE client_id = ? AND phone = ?
         AND logged_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       LIMIT 1`,
      [req.clientId, cleanPhone]
    );
    if (recent.length) {
      return res.status(409).json({ success: false, error: `A review request was already sent to ${phone} in the last 24 hours.` });
    }

    const payload = {
      customer_name, phone: cleanPhone, email: email||'',
      business_name: client.business,
      review_link: client.google_review_link || '',
      client_id: req.clientId,
      trigger: 'client_portal_single',
      timestamp: new Date().toISOString()
    };
    const result = await triggerN8n(payload);
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.error || 'WhatsApp delivery failed — please try again.' });
    }

    await pool.query(
      'INSERT INTO send_log (client_id, customer_name, phone, email, business, review_link, message_sid, webhook_ok, trigger_type) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.clientId, customer_name, cleanPhone, email||'', client.business, client.google_review_link||'', result.sid||null, 1, 'portal_single']
    );
    await pool.query('UPDATE clients SET reviews_sent = reviews_sent + 1 WHERE id = ?', [req.clientId]);

    res.json({ success: true, message: 'Review request sent', sid: result.sid });
    
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
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

    // Fetch phones already sent in last 24h to skip duplicates
    const phonesInBatch = customers.map(c => c.phone.replace(/\D/g, '')).filter(Boolean);
    const [recentLogs] = phonesInBatch.length
      ? await pool.query(
          `SELECT phone FROM send_log
           WHERE client_id = ? AND phone IN (?) AND logged_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
          [req.clientId, phonesInBatch]
        )
      : [[]];
    const alreadySentPhones = new Set(recentLogs.map(r => r.phone));

    const results = [];
    let successCount = 0;
    for (const c of customers) {
      const cleanPhone = c.phone.replace(/\D/g, '');
      if (alreadySentPhones.has(cleanPhone)) {
        results.push({ name: c.customer_name, phone: cleanPhone, ok: false, skipped: true, reason: 'sent in last 24h' });
        continue;
      }
      const payload = {
        customer_name: c.customer_name, phone: cleanPhone, email: c.email,
        business_name: client.business, review_link: client.google_review_link||'',
        client_id: req.clientId, trigger: 'client_portal_bulk'
      };
      const r = await triggerN8n(payload);
      if (r.ok) {
        await pool.query(
          'INSERT INTO send_log (client_id, customer_name, phone, email, business, review_link, message_sid, webhook_ok, trigger_type) VALUES (?,?,?,?,?,?,?,?,?)',
          [req.clientId, c.customer_name, cleanPhone, c.email, client.business, client.google_review_link||'', r.sid||null, 1, 'portal_bulk']
        );
        alreadySentPhones.add(cleanPhone); // prevent duplicate within same batch
        successCount++;
      }
      results.push({ name: c.customer_name, phone: cleanPhone, ok: r.ok });
      await new Promise(resolve => setTimeout(resolve, 300)); // throttle
    }
    await pool.query('UPDATE clients SET reviews_sent = reviews_sent + ? WHERE id = ?', [successCount, req.clientId]);

    const skipped = results.filter(r => r.skipped).length;
    res.json({ success: true, total: customers.length, sent: successCount, skipped, results });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
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
 if (!result.ok) {
    return res.status(500).json({ success: false, error: result.error || 'n8n webhook failed for review' });
  }
  try {
    const pool = await getDB();
    await pool.query(
      'INSERT INTO send_log (customer_name, phone, email, business, review_link, webhook_ok, trigger_type) VALUES (?,?,?,?,?,?,?)',
      [customer_name, phone, email||'', business, review_link||'', result.ok?1:0, 'api_single']
    );
  } catch {}

  if (result.ok) res.json({ success: true, message: 'Review request queued', payload });
  
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

    // Send welcome email to client (if email provided)
    if (req.body.email) {
      sendEmail({
        to: req.body.email,
        subject: '🎉 Welcome to AutoGreet — Your Account is Ready!',
        html: welcomeEmailHtml(req.body.owner||'', req.body.business||'', req.body.email, tempPass, req.body.plan||'starter')
      }).catch(()=>{});
    }

    // Notify admins of new signup
    sendEmail({
      to: ADMIN_EMAILS,
      subject: `🔔 New AutoGreet Signup — ${req.body.business || req.body.owner}`,
      html: adminNotifyHtml(req.body.owner||'', req.body.business||'', req.body.email||'', req.body.plan||'starter', 'Signup (Self-Onboarding)')
    }).catch(()=>{});

    res.json({
      success: true,
      client_id: result.insertId,
      message: 'Onboarding received — welcome email sent with login details',
      portal_url: 'https://autogreet.in/portal.html'
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── CLIENT: UPDATE OWN PROFILE ────────────────────────────────
app.patch('/api/client/profile', requireClient, async (req, res) => {
  try {
    const pool = await getDB();
    const allowed = ['google_review_link','business','owner','city','phone','email'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (req.body.new_password) {
      if (req.body.new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      updates['password_hash'] = hashPassword(req.body.new_password);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await pool.query(
      `UPDATE clients SET ${setClauses}, updated_at = NOW() WHERE id = ?`,
      [...Object.values(updates), req.clientId]
    );

    const [rows] = await pool.query(
      'SELECT id,owner,business,type,city,phone,email,plan,payment_status,google_review_link,monthly_target,reviews_sent,reviews_received,rating_before,rating_after,go_live_date,status FROM clients WHERE id = ?',
      [req.clientId]
    );
    res.json({ success: true, client: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/logs', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const [rows] = await pool.query('SELECT * FROM send_log ORDER BY logged_at DESC LIMIT 200');
    const [cnt]  = await pool.query('SELECT COUNT(*) as total FROM send_log');
    res.json({ total: cnt[0].total, logs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/clients/:id', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const allowed = ['owner','business','type','city','phone','email','plan','payment_status','payment_amount','payment_date','payment_ref','google_review_link','monthly_target','reviews_sent','reviews_received','rating_before','rating_after','status','go_live_date','notes'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const plainPass = req.body.new_password || null;
    if (plainPass) {
      updates['password_hash'] = hashPassword(plainPass);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await pool.query(`UPDATE clients SET ${setClauses}, updated_at = NOW() WHERE id = ?`, [...Object.values(updates), req.params.id]);

    const [rows] = await pool.query('SELECT id,owner,business,plan,status,payment_status,email FROM clients WHERE id = ?', [req.params.id]);
    const updated = rows[0];

    // Send credentials email if password was just set
    if (plainPass && updated?.email && req.body.send_welcome !== false) {
      sendEmail({
        to: updated.email,
        subject: '🔑 AutoGreet Portal Access — Your Login Details',
        html: welcomeEmailHtml(updated.owner, updated.business, updated.email, plainPass, updated.plan)
      }).catch(()=>{});
    }

    res.json({ success: true, client: updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/clients/:id', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    await pool.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── ADMIN: CREATE CLIENT (with welcome email) ─────────────────
app.post('/api/admin/create-client', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const { owner, business, type, city, phone, email, plan, payment_status,
            payment_amount, payment_date, payment_ref, google_review_link,
            monthly_target, notes, new_password, send_welcome = true } = req.body;

    if (!owner || !business) return res.status(400).json({ error: 'owner and business are required' });

    const plainPass = new_password || (business.split(' ')[0] + '@' + new Date().getFullYear());
    const pwHash    = hashPassword(plainPass);

    const [result] = await pool.query(
      `INSERT INTO clients
         (owner,business,type,city,phone,email,plan,payment_status,payment_amount,payment_date,payment_ref,
          google_review_link,monthly_target,password_hash,status,notes,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        owner, business, type||'', city||'Lucknow', phone||'', email||'',
        plan||'starter', payment_status||'pending',
        payment_amount||null, payment_date||null, payment_ref||null,
        google_review_link||'', monthly_target||30,
        pwHash, 'active', notes||''
      ]
    );

    // Send welcome email to client
    if (email && send_welcome) {
      sendEmail({
        to: email,
        subject: '🎉 Welcome to AutoGreet — Your Dashboard is Ready!',
        html: welcomeEmailHtml(owner, business, email, plainPass, plan||'starter')
      }).catch(()=>{});
    }

    // Notify admins
    sendEmail({
      to: ADMIN_EMAILS,
      subject: `✅ New Client Registered — ${business}`,
      html: adminNotifyHtml(owner, business, email||'', plan||'starter', 'Admin Registration')
    }).catch(()=>{});

    res.json({
      success: true,
      client_id: result.insertId,
      message: 'Client created' + (email && send_welcome ? ' — welcome email sent' : '')
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PAYMENT WEBHOOK (Razorpay) ────────────────────────────────
// Set this URL in Razorpay Dashboard → Webhooks → payment.captured
app.post('/api/payment/webhook', async (req, res) => {
  try {
    const entity  = req.body?.payload?.payment?.entity || {};
    const notes   = entity.notes || {};
    const clientId = notes.client_id;
    const payId   = entity.id || 'RZPAY';
    const amtRs   = entity.amount ? entity.amount / 100 : null;  // paise → rupees
    const bizName = notes.business || entity.description || 'Client';
    const ownerNm = notes.owner    || 'Client';
    const planLbl = notes.plan     || 'Unknown Plan';

    if (clientId) {
      const pool = await getDB();
      await pool.query(
        `UPDATE clients SET payment_status='paid', payment_amount=?, payment_ref=?, payment_date=CURDATE()
         WHERE id = ? AND payment_status != 'paid'`,
        [amtRs, payId, clientId]
      );
      console.log(`💰 Payment recorded for client ${clientId}: ${payId} ₹${amtRs}`);
      // Send invoice to client
      const [cRows] = await pool.query('SELECT * FROM clients WHERE id = ?', [clientId]);
      if (cRows.length && cRows[0].email) {
        sendEmail({
          to: cRows[0].email,
          subject: `🧾 Payment Confirmed — AutoGreet Invoice #AG-${String(clientId).padStart(4,'0')}`,
          html: invoiceEmailHtml(cRows[0])
        }).catch(()=>{});
      }
    }

    await sendEmail({
      to: ADMIN_EMAILS,
      subject: `💰 Payment Received — ${bizName} (${planLbl})`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f4f7f9;padding:16px;">
        <div style="background:#0F2440;border-radius:12px;padding:20px;margin-bottom:14px;">
          <strong style="color:#25D366;font-size:18px;">💰 Payment Received!</strong>
        </div>
        <div style="background:#fff;border-radius:10px;padding:20px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:7px 0;color:#666;width:120px;">Business</td><td style="font-weight:700;color:#0F2440;">${bizName}</td></tr>
            <tr><td style="padding:7px 0;color:#666;">Owner</td><td>${ownerNm}</td></tr>
            <tr><td style="padding:7px 0;color:#666;">Plan</td><td>${planLbl}</td></tr>
            <tr><td style="padding:7px 0;color:#666;">Amount</td><td style="font-size:18px;font-weight:800;color:#25D366;">₹${amtRs ? amtRs.toLocaleString('en-IN') : 'N/A'}</td></tr>
            <tr><td style="padding:7px 0;color:#666;">Payment ID</td><td style="font-family:monospace;">${payId}</td></tr>
            <tr><td style="padding:7px 0;color:#666;">Time</td><td>${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
          <a href="https://autogreet.in/admin.html" style="display:inline-block;margin-top:16px;background:#25D366;color:#0F2440;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Open Admin Dashboard →</a>
        </div>
      </div>`
    });

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Payment webhook error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DEMO LEADS
// ══════════════════════════════════════════════════════════════

// POST /api/demo-request — public, Book a Demo form
app.post('/api/demo-request', demoLimiter, async (req, res) => {
  const { name, email, phone, business_name, location } = req.body;
  if (!name || name.length > 120)   return res.status(400).json({ error: 'Name is required (max 120 chars)' });
  if (!email && !phone)             return res.status(400).json({ error: 'Either email or mobile number is required' });
  if (email  && email.length  > 200) return res.status(400).json({ error: 'Email too long' });
  if (phone  && phone.length  > 20)  return res.status(400).json({ error: 'Phone too long' });
  try {
    const pool = await getDB();
    // Ensure table exists with correct ENUM (demo_pending, not pending)
    await pool.query(`CREATE TABLE IF NOT EXISTS demo_leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(200),
      phone VARCHAR(20),
      business_name VARCHAR(200),
      location VARCHAR(200),
      status ENUM('demo_pending','demo_given','not_interested','client_onboarded') DEFAULT 'demo_pending',
      notes TEXT,
      created_at DATETIME DEFAULT NOW(),
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
    )`);
    const [result] = await pool.query(
      'INSERT INTO demo_leads (name, email, phone, business_name, location) VALUES (?,?,?,?,?)',
      [name.trim(), email||'', phone||'', business_name||'', location||'']
    );
    // Notify admin
    sendEmail({
      to: ADMIN_EMAILS,
      subject: `📅 New Demo Request — ${business_name || name}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f4f7f9;padding:16px;">
        <div style="background:#1A1A2E;border-radius:12px;padding:20px;margin-bottom:14px;">
          <strong style="color:#E94560;font-size:18px;">📅 New Demo Request!</strong>
        </div>
        <div style="background:#fff;border-radius:10px;padding:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#666;width:130px;">Name</td><td style="font-weight:700;color:#1A1A2E;">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Business</td><td>${business_name||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Location</td><td>${location||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Email</td><td>${email||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Mobile</td><td>${phone||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Time</td><td>${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
          <a href="https://autogreet.in/admin.html" style="display:inline-block;margin-top:16px;background:#E94560;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Open Admin Dashboard →</a>
        </div>
      </div>`
    }).catch(()=>{});
    // Send confirmation to prospect if email provided
    if (email) {
      sendEmail({
        to: email,
        subject: '📅 Demo Booked — AutoGreet will reach out within 24 hours!',
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f4f7f9;padding:20px;">
          <div style="background:#1A1A2E;border-radius:16px;padding:28px;text-align:center;margin-bottom:20px;">
            <div style="font-size:26px;font-weight:900;color:#fff;">Auto<span style="color:#E94560">Greet</span></div>
            <div style="color:rgba(255,255,255,.6);font-size:13px;">AI Google Review Automation</div>
          </div>
          <div style="background:#fff;border-radius:12px;padding:28px;">
            <p style="color:#1A1A2E;font-size:16px;font-weight:700;">Hi ${name}! 👋</p>
            <p style="color:#444;line-height:1.7;">Thanks for requesting a demo! We've received your details and will reach out to you within <strong>24 hours</strong> to schedule your free 15-minute demo.</p>
            <p style="color:#444;line-height:1.7;">In the meantime, you can WhatsApp us directly at <a href="https://wa.me/919250257509" style="color:#E94560;">+91 92502 57509</a> for a faster response.</p>
            <div style="background:#f8f9fa;border-radius:10px;padding:16px;margin-top:20px;">
              <p style="color:#666;font-size:13px;margin:0;">In the demo we'll show you:</p>
              <ul style="color:#444;font-size:13px;line-height:2;margin:8px 0 0 16px;">
                <li>Your current Google review count vs competitors</li>
                <li>Live demo of the AI review automation system</li>
                <li>Exactly how many reviews you can get in 60 days</li>
              </ul>
            </div>
          </div>
          <div style="text-align:center;color:#888;font-size:12px;margin-top:16px;">AutoGreet · autogreet.in · Lucknow, India</div>
        </div>`
      }).catch(()=>{});
    }
    res.json({ success: true, id: result.insertId, message: 'Demo request received' });
  } catch {
    res.status(500).json({ error: 'Could not save demo request — please try again' });
  }
});

// GET /api/demo-leads — admin, list all demo requests
app.get('/api/demo-leads', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const [rows] = await pool.query('SELECT id,name,email,phone,business_name,location,status,notes,created_at FROM demo_leads ORDER BY created_at DESC');
    const [counts] = await pool.query("SELECT status, COUNT(*) as cnt FROM demo_leads GROUP BY status");
    const summary = { demo_pending:0, demo_given:0, not_interested:0, client_onboarded:0, total: rows.length };
    counts.forEach(r => { if (r.status in summary) summary[r.status] = Number(r.cnt); });
    res.json({ summary, leads: rows });
  } catch {
    res.status(500).json({ error: 'Could not load demo leads' });
  }
});

// PATCH /api/demo-leads/:id — admin, update status/notes
app.patch('/api/demo-leads/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body;
  const VALID_STATUSES = ['demo_pending','demo_given','not_interested','client_onboarded'];
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const pool = await getDB();
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (status) await pool.query('UPDATE demo_leads SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
    if (notes !== undefined) await pool.query('UPDATE demo_leads SET notes = ?, updated_at = NOW() WHERE id = ?', [notes.slice(0, 2000), id]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ══════════════════════════════════════════════════════════════
//  CLIENT SELF-SIGNUP
// ══════════════════════════════════════════════════════════════

app.post('/api/client/signup', signupLimiter, async (req, res) => {
  const { owner, business, email, phone, password, city, type } = req.body;
  if (!owner || !business)           return res.status(400).json({ error: 'Name and business name are required' });
  if (!email && !phone)              return res.status(400).json({ error: 'Either email or phone is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (password.length > 200)        return res.status(400).json({ error: 'Password too long' });
  if (owner.length > 200 || business.length > 200) return res.status(400).json({ error: 'Input too long' });
  try {
    const pool = await getDB();
    if (email) {
      const [existing] = await pool.query('SELECT id FROM clients WHERE LOWER(email) = ?', [email.toLowerCase().slice(0,200)]);
      if (existing.length) return res.status(409).json({ error: 'An account with this email already exists — please log in.' });
    }
    const pwHash = hashPassword(password);
    const [result] = await pool.query(
      `INSERT INTO clients (owner,business,type,city,phone,email,plan,payment_status,password_hash,status,created_at)
       VALUES (?,?,?,?,?,?,'starter','pending',?,?,NOW())`,
      [owner.trim().slice(0,200), business.trim().slice(0,200), (type||'').slice(0,100), (city||'').slice(0,100), (phone||'').slice(0,20), (email||'').slice(0,200), pwHash, 'new']
    );
    const token = generateToken();
    await pool.query(
      'INSERT INTO sessions (token, client_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
      [token, result.insertId]
    );
    // Welcome email — never include plaintext password in email
    if (email) {
      sendEmail({
        to: email,
        subject: '🎉 Welcome to AutoGreet — Your Account is Ready!',
        html: welcomeEmailHtml(owner, business, email, '(use the password you set during signup)', 'starter')
      }).catch(()=>{});
    }
    sendEmail({
      to: ADMIN_EMAILS,
      subject: `🔔 New Self-Signup — ${business}`,
      html: adminNotifyHtml(owner, business, email||phone, 'Starter (self-signup)', 'Self-Signup')
    }).catch(()=>{});

    res.json({
      success: true, token,
      client: { id: result.insertId, owner, business, email, plan: 'starter', payment_status: 'pending' }
    });
  } catch {
    res.status(500).json({ error: 'Signup failed — please try again' });
  }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN ANALYTICS
// ══════════════════════════════════════════════════════════════

app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const pool = await getDB();
    const [[clients]]  = await pool.query('SELECT COUNT(*) as total, SUM(payment_status="paid") as paid, SUM(payment_status="pending") as pending FROM clients');
    const [[revenue]]  = await pool.query('SELECT COALESCE(SUM(payment_amount),0) as total FROM clients WHERE payment_status="paid"');
    const [[logs]]     = await pool.query('SELECT COUNT(*) as total, SUM(webhook_ok=1) as ok FROM send_log');
    const [byPlan]     = await pool.query('SELECT plan, COUNT(*) as cnt FROM clients WHERE payment_status="paid" GROUP BY plan');
    const [byStatus]   = await pool.query('SELECT status, COUNT(*) as cnt FROM clients GROUP BY status');
    const [monthly]    = await pool.query('SELECT DATE_FORMAT(created_at,"%Y-%m") as month, COUNT(*) as signups, SUM(payment_status="paid") as paid FROM clients GROUP BY month ORDER BY month DESC LIMIT 12');
    let demoSummary = { total:0, pending:0, demo_given:0, not_interested:0, client_onboarded:0 };
    try {
      const [[dt]] = await pool.query('SELECT COUNT(*) as total FROM demo_leads');
      const [ds]   = await pool.query("SELECT status, COUNT(*) as cnt FROM demo_leads GROUP BY status");
      demoSummary.total = dt.total;
      ds.forEach(r => { demoSummary[r.status] = r.cnt; });
    } catch {}
    res.json({ clients, revenue: revenue.total, logs, byPlan, byStatus, monthly, demoSummary });
  } catch {
    res.status(500).json({ error: 'Analytics unavailable' });
  }
});

// ══════════════════════════════════════════════════════════════
//  CLIENT ANALYTICS (own data)
// ══════════════════════════════════════════════════════════════

app.get('/api/client/analytics', requireClient, async (req, res) => {
  try {
    const pool = await getDB();
    const [client] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.clientId]);
    if (!client.length) return res.status(404).json({ error: 'Not found' });
    const c = client[0];
    const [monthly] = await pool.query(
      'SELECT DATE_FORMAT(logged_at,"%Y-%m") as month, COUNT(*) as sent, SUM(webhook_ok=1) as ok FROM send_log WHERE client_id = ? GROUP BY month ORDER BY month DESC LIMIT 6',
      [req.clientId]
    );
    const [[totals]] = await pool.query(
      'SELECT COUNT(*) as total_sent, SUM(webhook_ok=1) as delivered FROM send_log WHERE client_id = ?',
      [req.clientId]
    );
    res.json({
      reviews_sent: c.reviews_sent || 0,
      reviews_received: c.reviews_received || 0,
      rating_before: c.rating_before || 0,
      rating_after: c.rating_after || 0,
      monthly_target: c.monthly_target || 30,
      payment_status: c.payment_status,
      plan: c.plan,
      go_live_date: c.go_live_date,
      total_sent: totals.total_sent,
      delivered: totals.delivered,
      monthly
    });
  } catch {
    res.status(500).json({ error: 'Analytics unavailable' });
  }
});

// ══════════════════════════════════════════════════════════════
//  INVOICE EMAIL (resend or on-demand)
// ══════════════════════════════════════════════════════════════

app.post('/api/client/invoice', requireClient, async (req, res) => {
  try {
    const pool = await getDB();
    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const c = rows[0];
    if (c.payment_status !== 'paid') return res.status(400).json({ error: 'No payment found to invoice' });
    if (!c.email) return res.status(400).json({ error: 'No email on file' });
    await sendEmail({ to: c.email, subject: `🧾 AutoGreet Invoice — ${c.business}`, html: invoiceEmailHtml(c) });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Could not send invoice' });
  }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN: SEED / UPSERT CLIENT  (one-time setup endpoint)
// ══════════════════════════════════════════════════════════════
app.post('/api/admin/seed-client', requireAdmin, async (req, res) => {
  const {
    owner, business, email, phone,
    city = 'Lucknow', type = '',
    plan = 'starter', payment_status = 'paid',
    payment_amount = 4999, payment_date, payment_ref = 'MANUAL',
    status = 'setup_in_progress', notes = '', password
  } = req.body;

  if (!owner || !business || !phone) return res.status(400).json({ error: 'owner, business, phone are required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'password (min 6 chars) is required' });

  try {
    const pool   = await getDB();
    const pwHash = hashPassword(password);

    const [existing] = await pool.query(
      'SELECT id FROM clients WHERE LOWER(email) = ? OR phone = ? LIMIT 1',
      [(email || '').toLowerCase(), phone]
    );

    let clientId, action;
    if (existing.length) {
      clientId = existing[0].id;
      await pool.query(
        `UPDATE clients SET
           owner=?, business=?, type=?, city=?, phone=?, email=?,
           plan=?, payment_status=?, payment_amount=?, payment_date=?,
           payment_ref=?, status=?, notes=?, password_hash=?, updated_at=NOW()
         WHERE id=?`,
        [owner, business, type, city, phone, email||'',
         plan, payment_status, payment_amount, payment_date||null,
         payment_ref, status, notes, pwHash, clientId]
      );
      action = 'updated';
    } else {
      const [r] = await pool.query(
        `INSERT INTO clients
           (owner,business,type,city,phone,email,plan,payment_status,payment_amount,payment_date,payment_ref,status,notes,password_hash,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [owner, business, type, city, phone, email||'',
         plan, payment_status, payment_amount, payment_date||null,
         payment_ref, status, notes, pwHash]
      );
      clientId = r.insertId;
      action   = 'inserted';
    }

    const [row] = await pool.query(
      'SELECT id,owner,business,email,phone,plan,payment_status,status FROM clients WHERE id=?',
      [clientId]
    );
    res.json({ success: true, action, client: row[0] });
  } catch {
    res.status(500).json({ error: 'Seed failed — check Railway logs' });
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
      console.log(`   → Enable Remote MySQL in hPanel → Databases