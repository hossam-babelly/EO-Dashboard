#!/usr/bin/env node
'use strict';

/**
 * أداة توليد مستخدم لـ USERS_JSON.
 * الاستخدام:
 *   node scripts/hash-user.js <email> <password> [role] [name]
 * role: admin | editor | viewer (افتراضي viewer)
 *
 * تطبع كائن المستخدم؛ اجمع عدة مستخدمين داخل مصفوفة JSON في متغيّر USERS_JSON.
 */

const bcrypt = require('bcryptjs');

const [, , email, password, role = 'viewer', ...nameParts] = process.argv;
if (!email || !password) {
  console.error('الاستخدام: node scripts/hash-user.js <email> <password> [role] [name]');
  process.exit(1);
}
const name = nameParts.join(' ') || email.split('@')[0];
const hash = bcrypt.hashSync(password, 10);
const user = { email, name, role, hash };
console.log(JSON.stringify(user));
