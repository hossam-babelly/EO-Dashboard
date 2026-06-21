#!/usr/bin/env node
'use strict';
// توليد مفاتيح VAPID لإشعارات Web Push. شغّله مرة واحدة وضع المفاتيح في متغيّرات البيئة.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
