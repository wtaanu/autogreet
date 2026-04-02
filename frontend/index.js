const DEMO_API = 'https://api.autogreet.in';

function openDemoModal() {
  document.getElementById('demoModal').style.display = 'block';
  document.getElementById('demoForm').style.display  = 'block';
  document.getElementById('demoSuccess').style.display = 'none';
  document.getElementById('demoError').style.display   = 'none';
  document.getElementById('demoForm').reset();
  document.body.style.overflow = 'hidden';
  document.getElementById('demoName').focus();
}

function closeDemoModal() {
  document.getElementById('demoModal').style.display = 'none';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDemoModal();
});

async function submitDemoForm(e) {
  e.preventDefault();
  const errEl  = document.getElementById('demoError');
  const btn    = document.getElementById('demoSubmitBtn');
  errEl.style.display = 'none';

  const name     = document.getElementById('demoName').value.trim();
  const business = document.getElementById('demoBusiness').value.trim();
  const location = document.getElementById('demoLocation').value.trim();
  const email    = document.getElementById('demoEmail').value.trim();
  const phone    = document.getElementById('demoPhone').value.trim();

  // Validation
  if (!name)     { showDemoError('Please enter your name.'); return; }
  if (!business) { showDemoError('Please enter your business name.'); return; }
  if (!location) { showDemoError('Please enter your location.'); return; }
  if (!email && !phone) {
    showDemoError('Please provide at least your email OR mobile number so we can reach you.'); return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showDemoError('Please enter a valid email address.'); return;
  }
  if (phone && !/^\+?[\d\s\-]{8,15}$/.test(phone)) {
    showDemoError('Please enter a valid mobile number.'); return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const res  = await fetch(DEMO_API + '/api/demo-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, business_name: business, location, email, phone })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');

    // Show success state
    document.getElementById('demoForm').style.display    = 'none';
    document.getElementById('demoSuccess').style.display = 'block';
  } catch(err) {
    showDemoError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📞 Book My Free Demo';
  }
}

function showDemoError(msg) {
  const el = document.getElementById('demoError');
  el.textContent = msg;
  el.style.display = 'block';
}
function toggleFaq(el) {
  const item   = el.parentElement;
  const answer = item.querySelector('.faq-a');
  const isOpen = item.classList.contains('open');
  // Close all others
  document.querySelectorAll('.faq-item.open').forEach(i => {
    i.classList.remove('open');
    i.querySelector('.faq-q').setAttribute('aria-expanded','false');
  });
  if (!isOpen) {
    item.classList.add('open');
    el.setAttribute('aria-expanded','true');
  }
}
// Keyboard: Enter/Space on FAQ questions
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.faq-q').forEach(q => {
    q.setAttribute('tabindex','0');
    q.setAttribute('role','button');
    q.setAttribute('aria-expanded','false');
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFaq(q); }
    });
  });
});