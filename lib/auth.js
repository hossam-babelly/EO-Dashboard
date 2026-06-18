'use strict';

const bcrypt = require('bcryptjs');
const store = require('./store');

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const firstTokenOf = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const restTokensOf = (s) => String(s || '').trim().split(/\s+/).slice(1).join(' ');

/** مستخدمو البديل من متغيّر البيئة USERS_JSON (عند تعطّل التخزين الدائم). */
function envUsers() {
  let users = [];
  if (process.env.USERS_JSON) {
    try { users = JSON.parse(process.env.USERS_JSON); if (!Array.isArray(users)) users = []; } catch (e) { console.error('USERS_JSON غير صالح:', e.message); }
  }
  if (!users.length && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH) {
    users = [{ email: process.env.ADMIN_EMAIL, name: 'المدير', role: 'admin', hash: process.env.ADMIN_PASSWORD_HASH }];
  }
  return users.map((u) => ({ ...u, active: u.active !== false }));
}

/** كل المستخدمين: من التخزين الدائم إن فُعّل، وإلا من البيئة. */
async function allUsers() {
  if (store.enabled) {
    const rows = await store.getUsersFull();
    if (rows && rows.length) return rows;
  }
  return envUsers();
}

const authEnabled = () => store.enabled || envUsers().length > 0;

async function verify(email, password) {
  const users = await allUsers();
  const u = users.find((x) => String(x.email).toLowerCase() === String(email || '').toLowerCase().trim());
  if (!u || !u.hash || u.active === false) return null;
  const ok = await bcrypt.compare(String(password || ''), u.hash);
  if (!ok) return null;
  const name = u.name || u.email;
  return { email: u.email, name, firstName: u.firstName || firstTokenOf(name), lastName: u.lastName || restTokensOf(name), role: u.role || 'viewer' };
}

function hasRole(user, min) {
  return !!user && (ROLE_RANK[user.role] || 0) >= (ROLE_RANK[min] || 99);
}

async function listUsers() {
  const users = await allUsers();
  return users.map((u) => {
    const name = u.name || u.email;
    return { email: u.email, name, firstName: u.firstName || firstTokenOf(name), lastName: u.lastName || '', role: u.role || 'viewer', active: u.active !== false };
  });
}

const hashPassword = (pw) => bcrypt.hash(String(pw), 10);

module.exports = { allUsers, listUsers, verify, hasRole, authEnabled, hashPassword, ROLE_RANK, storeEnabled: () => store.enabled };
