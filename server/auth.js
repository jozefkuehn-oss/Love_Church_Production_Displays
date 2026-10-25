// Leader and admin logins. Each person has their own name + PIN so every
// producer message shows who sent it. PINs are stored hashed, never as text.
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

function makeAuth(db) {
  const d = db.data;

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

  function login(accountId, pin) {
    const acct = d.accounts.find((a) => a.id === accountId);
    if (!checkPin(pin, acct)) return null;
    const token = crypto.randomBytes(24).toString('hex');
    d.sessions[token] = { accountId: acct.id, exp: Date.now() + SESSION_DAYS * 864e5 };
    db.save();
    return token;
  }

  function sessionAccount(req) {
    const token = parseCookies(req.headers.cookie).lcd_session;
    const s = token && d.sessions[token];
    if (!s || s.exp < Date.now()) return null;
    return d.accounts.find((a) => a.id === s.accountId) || null;
  }

  function logout(req) {
    const token = parseCookies(req.headers.cookie).lcd_session;
    if (token) {
      delete d.sessions[token];
      db.save();
    }
  }

  function publicAccount(a) {
    return a ? { id: a.id, name: a.name, pcoName: a.pcoName, role: a.role } : null;
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

  return { createAccount, login, logout, sessionAccount, publicAccount, requireLeader, requireAdmin, hashPin };
}

module.exports = { makeAuth };
