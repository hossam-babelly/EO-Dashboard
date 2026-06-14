'use strict';

const bcrypt = require('bcryptjs');

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

/**
 * مصدر المستخدمين: متغيّر البيئة USERS_JSON (مصفوفة كائنات):
 *   [{ "email": "..", "name": "..", "role": "admin|editor|viewer", "hash": "$2a.." }]
 * بديل تمهيدي: ADMIN_EMAIL + ADMIN_PASSWORD_HASH ينشئ مديراً واحداً.
 */
function loadUsers() {
  let users = [];
  if (process.env.USERS_JSON) {
    try {
      users = JSON.parse(process.env.USERS_JSON);
      if (!Array.isArray(users)) users = [];
    } catch (e) {
      console.error('USERS_JSON غير صالح:', e.message);
    }
  }
  if (!users.length && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH) {
    users = [{ email: process.env.ADMIN_EMAIL, name: 'المدير', role: 'admin', hash: process.env.ADMIN_PASSWORD_HASH }];
  }
  return users;
}

const authEnabled = () => loadUsers().length > 0;

async function verify(email, password) {
  const users = loadUsers();
  const u = users.find((x) => String(x.email).toLowerCase() === String(email || '').toLowerCase().trim());
  if (!u || !u.hash) return null;
  const ok = await bcrypt.compare(String(password || ''), u.hash);
  if (!ok) return null;
  return { email: u.email, name: u.name || u.email, role: u.role || 'viewer' };
}

function hasRole(user, min) {
  return !!user && (ROLE_RANK[user.role] || 0) >= (ROLE_RANK[min] || 99);
}

/** قائمة المستخدمين بدون التجزئة (لشاشة الإدارة). */
function listUsers() {
  return loadUsers().map((u) => ({ email: u.email, name: u.name || u.email, role: u.role || 'viewer' }));
}

module.exports = { loadUsers, listUsers, verify, hasRole, authEnabled, ROLE_RANK };
