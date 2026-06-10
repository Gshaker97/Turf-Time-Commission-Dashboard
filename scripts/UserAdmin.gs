/**
 * Turf Time — User Admin endpoint (Apps Script web app)
 *
 * Lets the dashboard's Admin page create logins, reset passwords, and
 * enable/disable a user's login — actions that need the Supabase service_role
 * key, which can never live in the browser.
 *
 * Security model: NO shared secret in the frontend. Every request carries the
 * calling admin's own Supabase access token. This endpoint verifies that token
 * with Supabase, looks up the caller's profile, and only proceeds if the caller
 * is an admin (role 'admin' OR is_admin = true). The service key stays here.
 *
 * Setup:
 *   1. Paste this as a new file in the SAME Apps Script project that runs
 *      ScheduleSync.gs (so it reuses SUPABASE_URL + SUPABASE_SERVICE_KEY).
 *   2. Deploy → New deployment → type "Web app" →
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the /exec URL.
 *   3. In the frontend's Railway variables set:  VITE_USER_ADMIN_URL = that URL
 *      then redeploy the frontend.
 *   4. After ANY edit here: Deploy → Manage deployments → edit → Version: New
 *      version (web-app URLs serve the deployed version, not the latest save).
 */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('SUPABASE_URL');
    const key = props.getProperty('SUPABASE_SERVICE_KEY');
    if (!url || !key) return uaErr_('Server missing SUPABASE_URL / SUPABASE_SERVICE_KEY');

    // 1) Authenticate the caller by their own access token.
    const token = body.token;
    if (!token) return uaErr_('Not signed in');
    const meResp = UrlFetchApp.fetch(url + '/auth/v1/user', {
      method: 'get',
      headers: { apikey: key, Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    if (meResp.getResponseCode() >= 300) return uaErr_('Session invalid — sign in again');
    const authId = JSON.parse(meResp.getContentText()).id;

    // 2) Authorize: caller must be an admin.
    const callerArr = uaGet_(url, key, '/rest/v1/profiles?select=role,is_admin,active&auth_id=eq.' + authId);
    const caller = callerArr[0];
    if (!caller || caller.active === false || !(caller.role === 'admin' || caller.is_admin === true)) {
      return uaErr_('Admins only');
    }

    // 3) Resolve the target profile by email (must already be on the roster).
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return uaErr_('Missing email');
    const targetArr = uaGet_(url, key, '/rest/v1/profiles?select=id,email,auth_id,name&email=eq.' + encodeURIComponent(email));
    const target = targetArr[0];
    if (!target) return uaErr_('No roster profile with that email — add the user first');

    switch (body.action) {
      case 'create_login':   return uaCreateLogin_(url, key, target, body.password);
      case 'reset_password': return uaResetPassword_(url, key, target, body.password);
      case 'set_active':     return uaSetActive_(url, key, target, body.active);
      default:               return uaErr_('Unknown action');
    }
  } catch (err) {
    return uaErr_(err.message);
  }
}

// Create the GoTrue auth login (auto-confirmed). The DB trigger auto-links it to
// the profile by email. Refuses if a login already exists.
function uaCreateLogin_(url, key, target, password) {
  if (target.auth_id) return uaErr_(target.name + ' already has a login.');
  const pw = password || uaTempPassword_();
  const resp = UrlFetchApp.fetch(url + '/auth/v1/admin/users', {
    method: 'post', contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ email: target.email, password: pw, email_confirm: true }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) return uaErr_('Create failed: ' + resp.getContentText().slice(0, 200));
  return uaOk_({ created: true, email: target.email, password: pw });
}

function uaResetPassword_(url, key, target, password) {
  if (!target.auth_id) return uaErr_(target.name + ' has no login yet — create one first.');
  const pw = password || uaTempPassword_();
  const resp = UrlFetchApp.fetch(url + '/auth/v1/admin/users/' + target.auth_id, {
    method: 'put', contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ password: pw }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) return uaErr_('Reset failed: ' + resp.getContentText().slice(0, 200));
  return uaOk_({ reset: true, email: target.email, password: pw });
}

// Disable/enable the login at the auth layer (ban). profiles.active is set by
// the dashboard separately; this makes the block real even for an active token.
function uaSetActive_(url, key, target, active) {
  if (!target.auth_id) return uaOk_({ note: 'No login to toggle.' });   // profile-only user
  const payload = active ? { ban_duration: 'none' } : { ban_duration: '876000h' };  // ~100y
  const resp = UrlFetchApp.fetch(url + '/auth/v1/admin/users/' + target.auth_id, {
    method: 'put', contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) return uaErr_('Toggle failed: ' + resp.getContentText().slice(0, 200));
  return uaOk_({ active: !!active });
}

// ── helpers ─────────────────────────────────────────────────
function uaGet_(url, key, path) {
  const resp = UrlFetchApp.fetch(url + path, {
    method: 'get', headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error('Lookup failed: ' + resp.getContentText().slice(0, 200));
  return JSON.parse(resp.getContentText());
}
function uaTempPassword_() {
  return 'TT-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
}
function uaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function uaOk_(data)  { return uaJson_(Object.assign({ ok: true }, data)); }
function uaErr_(msg)  { return uaJson_({ ok: false, error: msg }); }
