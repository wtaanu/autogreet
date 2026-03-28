# AutoGreet — Deploy to Hostinger (Go Live Guide)
**Make autogreet.in live in under 30 minutes**

---

## PART A: Upload Frontend to Hostinger (Website)

### Step 1 — Log into Hostinger
1. Go to: https://hpanel.hostinger.com
2. Click **Websites** → click **autogreet.in** → **Manage**
3. Go to **Files → File Manager**

### Step 2 — Upload Frontend Files
1. Open the `public_html` folder (this is your website root)
2. Click **Upload** → upload these files from your `Code/frontend/` folder:
   - `index.html`       ← Main website (autogreet.in)
   - `onboard.html`     ← Client onboarding form (autogreet.in/onboard.html)
   - `demo.html`        ← Demo dashboard (autogreet.in/demo.html)
   - `favicon-192.png`  ← Website icon
   - `favicon-32.png`   ← Browser tab icon

3. Also upload from your project root:
   - `autogreet-icon.png`
   - `autogreet-logo.svg`

### Step 3 — Set Favicon in Hostinger
1. In hPanel → **Websites** → **AutoGreet.in** → **Settings**
2. Upload `favicon-32.png` as the site favicon

### Step 4 — Verify
Open your browser and go to: **https://autogreet.in**
Your website should be live! ✅

---

## PART B: Deploy Backend to Railway (Free Node.js Hosting)

The backend (server.js) needs a Node.js server. Use Railway.app (free):

### Step 1 — Create Railway Account
1. Go to: https://railway.app
2. Sign up with GitHub (create a free GitHub account first if needed)

### Step 2 — Create New Project
1. Click **New Project** → **Deploy from GitHub repo**
2. Upload your Code folder to GitHub:
   - Go to https://github.com/new → create repo "autogreet-backend"
   - Upload the `Code/backend/` folder contents

### Step 3 — Set Environment Variables
In Railway → your project → **Variables** tab, add:
```
N8N_WEBHOOK_URL = https://your-n8n-webhook-url
N8N_ONBOARD_WEBHOOK_URL = https://your-n8n-onboard-webhook-url
ADMIN_KEY = your-strong-admin-password
PORT = 3000
```

### Step 4 — Deploy
1. Railway will auto-detect Node.js and run `npm start`
2. Click **Generate Domain** → you'll get a URL like `autogreet-backend.up.railway.app`
3. Copy this URL

### Step 5 — Connect Frontend to Backend
In `demo.html`, update the webhook URL field default value to your Railway URL:
```javascript
// In demo.html, change the webhook-url input default value to:
value="https://autogreet-backend.up.railway.app/api/send-request"
```

In `onboard.html`, update the webhook URL in submitForm():
```javascript
const webhookUrl = 'https://autogreet-backend.up.railway.app/api/onboard';
```

---

## PART C: Connect Custom Domain to Backend (Optional)

Add a subdomain `api.autogreet.in` pointing to Railway:

1. In Hostinger hPanel → **Domains** → **autogreet.in** → **DNS / Nameservers**
2. Add a CNAME record:
   - **Name:** api
   - **Points to:** your-app.up.railway.app
3. In Railway → **Settings** → **Domains** → add `api.autogreet.in`

Now your API runs at: `https://api.autogreet.in`

---

## PART D: Update n8n Webhook URL

Once your n8n workflow is active, update the URL in:
1. Railway env variables (`N8N_WEBHOOK_URL`)
2. `demo.html` default webhook input value
3. `onboard.html` submitForm() webhook URL

---

## QUICK CHECKLIST

- [ ] Frontend uploaded to Hostinger public_html
- [ ] autogreet.in loading correctly in browser
- [ ] Favicon showing in browser tab
- [ ] Backend deployed to Railway
- [ ] Environment variables set in Railway
- [ ] demo.html webhook URL updated to Railway backend
- [ ] onboard.html webhook URL updated
- [ ] n8n workflow active and webhook URL confirmed
- [ ] Test: submit onboard form → check Railway logs

---

## SUPPORT

If anything goes wrong:
- WhatsApp: +91 92502 57509
- Email: anuragini.pathak@autogreet.in

---

## ONBOARDING PROCESS (How to handle new clients)

When a client fills in `onboard.html`:

1. **You receive a WhatsApp notification** (via n8n onboard webhook)
2. **Call/WhatsApp client** within 2 hours to confirm
3. **Ask them to:**
   - Add you as Google Business Profile Manager
   - Send you their customer list (name + phone CSV)
4. **Set up their n8n workflow instance** (follow n8n_setup_guide.md)
5. **Test** — send a review request to their own phone
6. **Go live** — upload first 20 customers from their list
7. **Send welcome email** (use template in client_onboarding_pack.md)
8. **Set 2-week check-in** reminder

Total time per client: 3–4 hours
```

*AutoGreet | autogreet.in*
