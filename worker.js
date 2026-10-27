/* TWIXX HQ — serveur de notifications push (Cloudflare Worker, gratuit)
 *
 * Rôle : garder les abonnements des joueurs, lire le planning publié dans ton gist
 * toutes les 5 minutes et envoyer les rappels (veille + avant l'événement).
 *
 * Réglages à créer dans Cloudflare (Settings › Variables and Secrets / Bindings) :
 *   KV (binding)      nom de variable : KV
 *   VAPID_PUBLIC      clé publique générée avec generer-cles.html
 *   VAPID_PRIVATE     clé privée (Secret)
 *   VAPID_SUBJECT     mailto:ton-adresse@exemple.com
 *   DATA_URL          lien « raw » de ton gist (le même que « Mise à jour partagée »)
 *   ADMIN_KEY         mot de passe de ton choix (Secret), pour les boutons Test / Abonnés
 *   ADMIN_NAME        (facultatif) ton pseudo admin, par défaut MijeMije
 * Déclencheur : Triggers › Cron › toutes les 5 minutes (voir GUIDE.md pour l’expression exacte)
 */
const enc = new TextEncoder();
const WINDOW_MS = 7 * 60 * 1000;      // fenêtre de rattrapage (le cron tourne toutes les 5 min)
const MAX_SENDS = 40;                 // limite gratuite : 50 requêtes par exécution
const KEEP_MS = 4 * 24 * 3600 * 1000; // mémoire des rappels déjà envoyés

const b64u = buf => { const a = new Uint8Array(buf); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

/* ---------- Web Push : chiffrement (RFC 8291) + signature VAPID (RFC 8292) ---------- */
async function vapidKey(env) {
  const pub = unb64(env.VAPID_PUBLIC);
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
async function vapidJWT(env, aud) {
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), enc.encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function encrypt(sub, payload) {
  const ua = unb64(sub.keys.p256dh), auth = unb64(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPub, ct);
}
async function sendPush(env, rec, msg) {
  const ep = rec.sub.endpoint, jwt = await vapidJWT(env, new URL(ep).origin), body = await encrypt(rec.sub, JSON.stringify(msg));
  const r = await fetch(ep, { method: 'POST', headers: { Authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }, body });
  return r.status;
}

/* ---------- Dates : mêmes règles de répétition que le site ---------- */
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const pd = k => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDay = (k, n) => { const d = pd(k); d.setDate(d.getDate() + n); return ymd(d); };
const plMon = k => { const d = pd(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
const REC = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
function plNth(e, n) {
  const s = pd(e.date), r = e.rec, y0 = s.getFullYear(), m0 = s.getMonth(), d0 = s.getDate();
  if (r == 'daily') return new Date(y0, m0, d0 + n);
  if (r == 'weekly') return new Date(y0, m0, d0 + 7 * n);
  if (r == 'biweekly') return new Date(y0, m0, d0 + 14 * n);
  if (r == 'monthly' || r == 'yearly') { const mm = m0 + (r == 'yearly' ? 12 * n : n), y = y0 + Math.floor(mm / 12), m = ((mm % 12) + 12) % 12, dim = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(d0, dim)); }
  return s;
}
function plOcc(e, a, b) {
  if (!e.date) return [];
  if (!e.rec || !REC.includes(e.rec)) return e.date >= a && e.date <= b ? [e.date] : [];
  const out = [], ex = e.ex || [], end = e.until && e.until < b ? e.until : b;
  for (let n = 0; n < 6000; n++) { const k = ymd(plNth(e, n)); if (k > end) break; if (k >= a && !ex.includes(k)) out.push(k); }
  return out;
}
/* Date + heure locales (dans le fuseau choisi) -> instant UTC en millisecondes */
function tzOffsetMin(tz, utcMs) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000) / 60000;
}
function localToUtc(key, hh, mm, tz) {
  const [y, m, d] = key.split('-').map(Number), guess = Date.UTC(y, m - 1, d, hh, mm);
  const t = guess - tzOffsetMin(tz, guess) * 60000;
  return guess - tzOffsetMin(tz, t) * 60000;
}

/* ---------- Rappels ---------- */
function occurrences(data, nowMs) {
  const a = ymd(new Date(nowMs - 86400000)), b = ymd(new Date(nowMs + 4 * 86400000));
  const out = [];
  (data.planning || []).forEach(e => plOcc(e, a, b).forEach(k => out.push({ ...e, date: k })));
  return out;
}
function remindersFor(occ, prefs, tz, wmaps, site) {
  const out = [], hasT = /^\d{1,2}:\d{2}$/.test(occ.time || '');
  const wm = ['Match', 'Tournoi', 'Entraînement'].includes(occ.type) ? (wmaps || {})[plMon(occ.date)] : '';
  const what = (occ.type || 'Événement') + (hasT ? ' ' + occ.time : '') + ' — ' + occ.title + (wm ? ' · ◎ ' + wm : '');
  const base = { url: './#plan' };
  if (prefs.veille !== false) out.push({ kind: 'veille', at: localToUtc(addDay(occ.date, -1), 18, 0, tz), msg: { ...base, title: '◆ ' + site + ' · Demain', body: what, tag: 'ev-' + occ.id + '-' + occ.date + '-v' } });
  const av = prefs.avant == null ? 60 : +prefs.avant;
  if (hasT && av > 0) {
    const [hh, mm] = occ.time.split(':').map(Number), lbl = av >= 60 ? (av / 60) + ' h' : av + ' min';
    out.push({ kind: 'avant', at: localToUtc(occ.date, hh, mm, tz) - av * 60000, msg: { ...base, title: '◆ ' + site + ' · Dans ' + lbl, body: what, tag: 'ev-' + occ.id + '-' + occ.date + '-a' } });
  } else if (!hasT && av > 0) {
    out.push({ kind: 'avant', at: localToUtc(occ.date, 9, 0, tz), msg: { ...base, title: '◆ ' + site + ' · Aujourd’hui', body: what, tag: 'ev-' + occ.id + '-' + occ.date + '-a' } });
  }
  return out;
}
async function loadData(env) {
  const r = await fetch(env.DATA_URL + (env.DATA_URL.includes('?') ? '&' : '?') + '_=' + Date.now(), { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error('DATA_URL : HTTP ' + r.status);
  return r.json();
}
const subId = async ep => b64u(await crypto.subtle.digest('SHA-256', enc.encode(ep))).slice(0, 16);

async function run(env, nowMs = Date.now()) {
  const subs = (await env.KV.get('subs', 'json')) || {};
  const ids = Object.keys(subs);
  if (!ids.length) return { sent: 0, subs: 0 };
  const data = await loadData(env), tz = (data.push && data.push.tz) || 'Europe/Paris', site = data.name || 'TWIXX HQ';
  const sent = (await env.KV.get('sent', 'json')) || {};
  const occ = occurrences(data, nowMs), jobs = [];
  for (const id of ids) {
    for (const o of occ) for (const r of remindersFor(o, subs[id].prefs || {}, tz, data.wmaps, site)) {
      const key = id + '|' + o.id + '|' + o.date + '|' + r.kind;
      if (r.at <= nowMs && r.at > nowMs - WINDOW_MS && !sent[key]) jobs.push({ id, key, msg: r.msg });
    }
  }
  let n = 0, dirty = false;
  for (const j of jobs.slice(0, MAX_SENDS)) {
    try {
      const st = await sendPush(env, subs[j.id], j.msg);
      if (st == 404 || st == 410) { delete subs[j.id]; dirty = true; }
      else if (st >= 200 && st < 300) { sent[j.key] = nowMs; n++; }
      else sent[j.key] = nowMs; // refus définitif (ex. 400) : on ne réessaie pas
    } catch (e) { /* réessai au prochain passage tant que la fenêtre est ouverte */ }
  }
  for (const k in sent) if (nowMs - sent[k] > KEEP_MS) delete sent[k];
  if (jobs.length) await env.KV.put('sent', JSON.stringify(sent));
  if (dirty) await env.KV.put('subs', JSON.stringify(subs));
  return { sent: n, subs: ids.length, due: jobs.length };
}

/* ---------- HTTP ---------- */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-admin-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isAdmin = (req, env) => !!env.ADMIN_KEY && req.headers.get('x-admin-key') === env.ADMIN_KEY;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const handler = {
  async fetch(req, env, ctx) {
    if (req.method == 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    try {
      if (req.method == 'GET' && url.pathname == '/') return new Response('TWIXX HQ · serveur de notifications OK', { headers: CORS });
      if (req.method == 'POST' && url.pathname == '/subscribe') {
        const b = await req.json(), s = b.sub;
        if (!s || !/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: 'abonnement invalide' }, 400);
        const data = await loadData(env), name = String(b.name || '').trim();
        const known = (data.players || []).some(p => norm(p.name) == norm(name)) || norm(name) == norm(env.ADMIN_NAME || 'MijeMije');
        if (!known) return json({ error: 'pseudo inconnu : demande à l’admin de t’ajouter au roster' }, 403);
        const subs = (await env.KV.get('subs', 'json')) || {}, id = await subId(s.endpoint), isNew = !subs[id];
        if (isNew && Object.keys(subs).length >= 200) return json({ error: 'trop d’abonnements' }, 429);
        const pv = b.prefs || {};
        subs[id] = { sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, name, prefs: { veille: pv.veille !== false, avant: Math.max(0, Math.min(1440, +pv.avant || 0)) }, ts: Date.now() };
        if (b.prefs && pv.avant == null) subs[id].prefs.avant = 60;
        await env.KV.put('subs', JSON.stringify(subs));
        if (isNew && !b.quiet) ctx.waitUntil(sendPush(env, subs[id], { title: '◆ ' + (data.name || 'TWIXX HQ'), body: 'Notifications du planning activées pour ' + name + '. Tu recevras un rappel la veille et avant chaque événement.', url: './#plan', tag: 'welcome' }).catch(() => {}));
        return json({ ok: true, isNew });
      }
      if (req.method == 'POST' && url.pathname == '/unsubscribe') {
        const b = await req.json(), subs = (await env.KV.get('subs', 'json')) || {}, id = await subId(String(b.endpoint || ''));
        if (subs[id]) { delete subs[id]; await env.KV.put('subs', JSON.stringify(subs)); }
        return json({ ok: true });
      }
      if (url.pathname == '/stats' && req.method == 'GET') {
        if (!isAdmin(req, env)) return json({ error: 'clé admin incorrecte' }, 401);
        const subs = (await env.KV.get('subs', 'json')) || {};
        return json({ count: Object.keys(subs).length, names: Object.values(subs).map(x => x.name) });
      }
      if (url.pathname == '/test' && req.method == 'POST') {
        if (!isAdmin(req, env)) return json({ error: 'clé admin incorrecte' }, 401);
        const b = await req.json().catch(() => ({})), subs = (await env.KV.get('subs', 'json')) || {};
        const list = Object.entries(subs).filter(([, x]) => !b.name || norm(x.name) == norm(b.name));
        let ok = 0, gone = 0;
        for (const [id, x] of list.slice(0, MAX_SENDS)) {
          try { const st = await sendPush(env, x, { title: '◆ Notification test', body: 'Si tu vois ceci, les notifications du planning fonctionnent.', url: './#plan', tag: 'test' }); if (st >= 200 && st < 300) ok++; else if (st == 404 || st == 410) { delete subs[id]; gone++; } } catch (e) {}
        }
        if (gone) await env.KV.put('subs', JSON.stringify(subs));
        return json({ sent: ok, total: list.length, removed: gone });
      }
      return json({ error: 'introuvable' }, 404);
    } catch (e) { return json({ error: String(e.message || e) }, 500); }
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(run(env)); }
};
export default handler;
