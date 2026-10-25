// Sign-in. Two kinds:
//  • Roles — the usual way in. You pick the role you're serving in today
//    (FOH Engineer, Service Producer…) and enter that role's shared PIN. The
//    session lasts until the end of the day, and what you can do comes from
//    the role's permissions (messages, live, wireless).
//  • Admin accounts — a personal name + PIN with access to everything.
// PINs are stored hashed, never as text. Repeated wrong PINs lock that
// role/account for a few minutes.
const crypto = require('crypto');

const SESSION_DAYS = 30;

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return { salt, hash };
}

function checkPin(pin, account) {
  if (!account || !account.pinHash) return false;
  const { hash } = hashPin(pin, account.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(account.pinHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

const PERMS = ['messages', 'live', 'wireless'];

function makeAuth(db, opts = {}) {
  const d = db.data;
  // opts.endOfDay() → ms timestamp when today ends (local church time)
  // opts.scheduledFor(roleName) → name of the person scheduled in that role today, or ''
  const endOfDay = opts.endOfDay || (() => Date.now() + 18 * 3600e3);
  const scheduledFor = opts.scheduledFor || (() => '');

  // ---- wrong-PIN lockout ----
  const fails = new Map(); // key → { n, until }
  function locked(key) {
    const f = fails.get(key);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
  }
  function noteFail(key) {
    const f = fails.get(key) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= 5) {
      f.until = Date.now() + 5 * 60000;
      f.n = 0;
    }
    fails.set(key, f);
  }

  function createAccount({ name, pcoName, role, pin }) {
    const { salt, hash } = hashPin(pin);
    const acct = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      pcoName: String(pcoName || name).trim(),
      role: role === 'admin' ? 'admin' : 'leader',
      salt,
      pinHash: hash,
      createdAt: new Date().toISOString(),
    };
    d.accounts.push(acct);
    db.save();
    return acct;
  }

  // Returns a token, or { error } for a lockout / wrong PIN.
  function login(accountId, pin) {
    const key = 'acct:' + accountId;
    const wait = locked(key);
    if (wait) return { error: `Too many tries. Try again in ${wait} min.` };
    const acct = d.accounts.find((a) => a.id === accountId);
    if (!checkPin(pin, acct)) {
      noteFail(key);
      return { error: 'That PIN didn’t match.' };
    }
    fails.delete(key);
    const token = crypto.randomBytes(24).toString('hex');
    d.sessions[token] = { accountId: acct.id, exp: Date.now() + SESSION_DAYS * 864e5 };
    db.save();
    return token;
  }

  // ---- roles ----
  function setRolePin(role, pin) {
    const { salt, hash } = hashPin(pin);
    role.salt = salt;
    role.pinHash = hash;
  }
  function loginRole(roleId, pin) {
    const key = 'role:' + roleId;
    const wait = locked(key);
    if (wait) return { error: `Too many tries. Try again in ${wait} min.` };
    const role = (d.roles || []).find((r) => r.id === roleId);
    if (!role || !role.pinHash) return { error: 'That role doesn’t have a PIN yet. Ask an admin.' };
    if (!checkPin(pin, role)) {
      noteFail(key);
      return { error: 'That PIN didn’t match.' };
    }
    fails.delete(key);
    const token = crypto.randomBytes(24).toString('hex');
    d.sessions[token] = { roleId: role.id, person: scheduledFor(role.name) || '', exp: endOfDay() };
    db.save();
    return token;
  }

  function sessionAccount(req) {
    const token = parseCookies(req.headers.cookie).lcd_session;
    const s = token && d.sessions[token];
    if (!s || s.exp < Date.now()) return null;
    if (s.roleId) {
      const r = (d.roles || []).find((x) => x.id === s.roleId);
      if (!r) return null;
      return {
        id: 'role:' + r.id,
        name: s.person ? `${s.person} (${r.name})` : r.name,
        pcoName: s.person || '',
        role: 'role',
        roleName: r.name,
        perms: r.perms || [],
        isRole: true,
      };
    }
    return d.accounts.find((a) => a.id === s.accountId) || null;
  }
  const can = (a, perm) => !!a && (a.role === 'admin' || (a.isRole ? a.perms.includes(perm) : perm === 'messages' || perm === 'live'));

  function logout(req) {
    const token = parseCookies(req.headers.cookie).lcd_session;
    if (token) {
      delete d.sessions[token];
      db.save();
    }
  }

  function publicAccount(a) {
    if (!a) return null;
    const out = { id: a.id, name: a.name, pcoName: a.pcoName, role: a.role };
    if (a.isRole) Object.assign(out, { roleName: a.roleName, perms: a.perms });
    else out.perms = a.role === 'admin' ? PERMS.slice() : ['messages', 'live'];
    return out;
  }

  // Express middleware
  const requireLeader = (req, res, next) => {
    const a = sessionAccount(req);
    if (!a) return res.status(401).json({ error: 'Please sign in.' });
    req.account = a;
    next();
  };
  const requireAdmin = (req, res, next) => {
    const a = sessionAccount(req);
    if (!a) return res.status(401).json({ error: 'Please sign in.' });
    if (a.role !== 'admin') return res.status(403).json({ error: 'Only admins can do that.' });
    req.account = a;
    next();
  };

  const requirePerm = (perm) => (req, res, next) => {
    const a = sessionAccount(req);
    if (!a) return res.status(401).json({ error: 'Please sign in.' });
    if (!can(a, perm)) return res.status(403).json({ error: 'Your role can’t do that.' });
    req.account = a;
    next();
  };

  return { scheduledFor, createAccount, login, loginRole, setRolePin, logout, sessionAccount, publicAccount, requireLeader, requireAdmin, requirePerm, can, hashPin, PERMS };
}

module.exports = { makeAuth };
