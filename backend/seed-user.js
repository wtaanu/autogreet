// ══════════════════════════════════════════════════════════════
//  AutoGreet — Seed / Upsert a client user in MySQL
//  Usage:  node seed-user.js
//  Reads the same .env as server.js — requires DB access
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const mysql  = require('mysql2/promise');
const crypto = require('crypto');

// ── PBKDF2 (must match server.js) ───────────────────────────
function hashPassword(pw, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512');
  return salt.toString('hex') + ':' + hash.toString('hex');
}

// ── USER TO SEED ─────────────────────────────────────────────
const USER = {
  owner:          'Prerana Singh',
  business:       'Taste Tales',
  type:           'Restaurant / Café',
  city:           'Lucknow',
  phone:          '7058113754',
  email:          'aritikasingh@gmail.com',
  plan:           'starter',
  payment_status: 'paid',
  payment_amount: 4999,
  payment_date:   '2026-03-28',
  payment_ref:    'MANUAL-001',
  status:         'setup_in_progress',
  notes:          'First client. Payment collected manually 28 March 2026.',
  password:       'ritika2609',   // plain — will be hashed below
};

// ── Ensure clients table exists ───────────────────────────────
const CREATE_CLIENTS = `
CREATE TABLE IF NOT EXISTS clients (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  owner            VARCHAR(200) NOT NULL,
  business         VARCHAR(200) NOT NULL,
  type             VARCHAR(100) DEFAULT '',
  city             VARCHAR(100) DEFAULT 'Lucknow',
  phone            VARCHAR(20)  NOT NULL,
  email            VARCHAR(200) DEFAULT '',
  plan             VARCHAR(30)  DEFAULT 'starter',
  payment_status   VARCHAR(30)  DEFAULT 'pending',
  payment_amount   DECIMAL(10,2) DEFAULT 0,
  payment_date     DATE,
  payment_ref      VARCHAR(100) DEFAULT '',
  google_review_link VARCHAR(500) DEFAULT '',
  gmaps_url        VARCHAR(500) DEFAULT '',
  monthly_target   INT DEFAULT 30,
  reviews_sent     INT DEFAULT 0,
  reviews_received INT DEFAULT 0,
  rating_before    DECIMAL(3,1) DEFAULT 0,
  rating_after     DECIMAL(3,1) DEFAULT 0,
  go_live_date     DATE,
  status           VARCHAR(50)  DEFAULT 'new',
  notes            TEXT,
  password_hash    VARCHAR(300),
  updated_at       DATETIME,
  created_at       DATETIME DEFAULT NOW(),
  INDEX idx_email  (email),
  INDEX idx_phone  (phone)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const CREATE_SESSIONS = `
CREATE TABLE IF NOT EXISTS sessions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  token      VARCHAR(128) NOT NULL UNIQUE,
  client_id  INT NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  expires_at DATETIME NOT NULL,
  INDEX idx_token     (token),
  INDEX idx_client    (client_id),
  INDEX idx_expires   (expires_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const CREATE_SEND_LOG = `
CREATE TABLE IF NOT EXISTS send_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  client_id     INT,
  customer_name VARCHAR(200),
  phone         VARCHAR(20),
  email         VARCHAR(200),
  business      VARCHAR(200),
  review_link   VARCHAR(500),
  message_sid   VARCHAR(100),
  webhook_ok    TINYINT DEFAULT 0,
  trigger_type  VARCHAR(50),
  logged_at     DATETIME DEFAULT NOW(),
  INDEX idx_client (client_id),
  INDEX idx_date   (logged_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const CREATE_DEMO_LEADS = `
CREATE TABLE IF NOT EXISTS demo_leads (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(200),
  phone         VARCHAR(20),
  business_name VARCHAR(200),
  location      VARCHAR(200),
  status        ENUM('demo_pending','demo_given','not_interested','client_onboarded') DEFAULT 'demo_pending',
  notes         TEXT,
  created_at    DATETIME DEFAULT NOW(),
  updated_at    DATETIME DEFAULT NOW() ON UPDATE NOW(),
  INDEX idx_status (status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

async function run() {
  const pool = await mysql.createPool({
    host:               process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT)     || 3306,
    database:           process.env.DB_NAME,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit:    3,
    ssl:                process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  console.log('🔌 Connected to MySQL:', process.env.DB_HOST, '/', process.env.DB_NAME);

  // Ensure all tables exist
  await pool.query(CREATE_CLIENTS);
  await pool.query(CREATE_SESSIONS);
  await pool.query(CREATE_SEND_LOG);
  await pool.query(CREATE_DEMO_LEADS);
  console.log('✅ Tables verified');

  const pwHash = hashPassword(USER.password);
  console.log('🔐 Password hashed (PBKDF2 / 100k iterations / SHA-512)');

  // Check if user already exists
  const [existing] = await pool.query(
    'SELECT id, owner, email FROM clients WHERE LOWER(email) = ? OR phone = ? LIMIT 1',
    [USER.email.toLowerCase(), USER.phone]
  );

  if (existing.length) {
    // Update password + payment_status for existing record
    const row = existing[0];
    await pool.query(
      `UPDATE clients SET
         password_hash  = ?,
         payment_status = ?,
         payment_amount = ?,
         payment_date   = ?,
         payment_ref    = ?,
         status         = ?,
         notes          = ?,
         updated_at     = NOW()
       WHERE id = ?`,
      [pwHash, USER.payment_status, USER.payment_amount, USER.payment_date, USER.payment_ref, USER.status, USER.notes, row.id]
    );
    console.log(`✏️  Updated existing client  id=${row.id}  "${row.owner}" <${row.email}>`);
    console.log('   ✅ Password, payment_status=paid — done.');
  } else {
    // Insert fresh record
    const [res] = await pool.query(
      `INSERT INTO clients
         (owner,business,type,city,phone,email,plan,payment_status,payment_amount,payment_date,payment_ref,status,notes,password_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        USER.owner, USER.business, USER.type, USER.city,
        USER.phone, USER.email, USER.plan,
        USER.payment_status, USER.payment_amount, USER.payment_date, USER.payment_ref,
        USER.status, USER.notes, pwHash,
      ]
    );
    console.log(`➕ Inserted new client  id=${res.insertId}  "${USER.owner}" <${USER.email}>`);
    console.log('   ✅ payment_status=paid, plan=starter — done.');
  }

  // Verify the record is readable
  const [verify] = await pool.query(
    'SELECT id, owner, business, email, phone, plan, payment_status, status FROM clients WHERE LOWER(email) = ? LIMIT 1',
    [USER.email.toLowerCase()]
  );
  if (verify.length) {
    console.log('\n📋 Verified DB record:');
    console.table(verify[0]);
    console.log('🔑 Login credentials:');
    console.log('   Username:', USER.email, '  OR  phone:', USER.phone);
    console.log('   Password:', USER.password, '(stored as PBKDF2 — never in DB plain)');
  }

  await pool.end();
  console.log('\n🎉 Seed complete. Client can now log in at https://autogreet.in/portal.html');
}

run().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
