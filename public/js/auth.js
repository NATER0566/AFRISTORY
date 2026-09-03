const API = '/api';
const views = ['login', 'register', 'forgot', 'pin'];
const statusEl = document.querySelector('#auth-status');
const jsonHeaders = { 'Content-Type': 'application/json' };

function showView(name) {
  views.forEach(view => document.querySelector(`#auth-${view}`)?.classList.toggle('hidden', view !== name));
  if (statusEl) statusEl.textContent = '';
}
function feedback(message, icon = 'error') {
  if (window.Swal) Swal.fire({ icon, text: message, confirmButtonColor: '#d4a017', background: '#242424', color: '#f5f5f5' });
  else if (statusEl) statusEl.textContent = message;
}
async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: 'include', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.message || 'Something went wrong');
  return payload;
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

async function checkSession() {
  try { await request('/auth/me'); window.location.replace('/app.html'); } catch { /* anonymous */ }
}
document.addEventListener('click', event => {
  const control = event.target.closest('[data-auth-view]');
  if (control) showView(control.dataset.authView);
});
document.querySelector('#login-form')?.addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
  try { await request('/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(formData(event.target)) }); window.location.replace('/app.html'); }
  catch (error) { feedback(error.message); } finally { button.disabled = false; }
});
document.querySelector('#register-form')?.addEventListener('submit', async event => {
  event.preventDefault(); const data = formData(event.target); const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
  try { await request('/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }); showView('pin'); }
  catch (error) { feedback(error.message); } finally { button.disabled = false; }
});
document.querySelector('#forgot-form')?.addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
  try { const result = await request('/auth/forgot-password', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(formData(event.target)) }); feedback(result.message, 'success'); showView('login'); }
  catch (error) { feedback(error.message); } finally { button.disabled = false; }
});
document.querySelector('#pin-form')?.addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
  try { await request('/auth/set-pin', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(formData(event.target)) }); feedback('PIN saved successfully', 'success'); showView('login'); }
  catch (error) { feedback(error.message); } finally { button.disabled = false; }
});
checkSession();
