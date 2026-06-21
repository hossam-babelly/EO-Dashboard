'use strict';

/**
 * إرسال تذكيرات عبر بوت Telegram.
 * - يُفعَّل عند ضبط TELEGRAM_BOT_TOKEN.
 * - لا يمكن مراسلة المستخدم برقمه مباشرةً؛ يجب أن يبدأ المستخدم البوت ويشارك رقمه مرّة واحدة،
 *   فنطابق الرقم مع المُدخَل في حسابه ونحفظ chat_id لإرسال الرسائل لاحقاً.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const enabled = !!TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

// تطبيع الرقم إلى أرقام فقط (يزيل + والمسافات والرموز)
function normPhone(s) { return String(s || '').replace(/\D/g, ''); }

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error((data && data.description) || ('Telegram ' + res.status));
  return data.result;
}

async function sendMessage(chatId, text) {
  if (!enabled || !chatId) return false;
  try { await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }); return true; }
  catch (e) { console.warn('telegram send:', e.message); return false; }
}

// رسالة الترحيب مع زرّ مشاركة الرقم (request_contact)
async function sendWelcome(chatId) {
  if (!enabled || !chatId) return;
  try {
    await call('sendMessage', {
      chat_id: chatId,
      text: 'مرحباً بك في تذكيرات لوحة الإدارة التنفيذية — مجموعة سنكري القابضة 👋\n\nلربط حسابك واستقبال التذكيرات هنا، اضغط الزر أدناه لمشاركة رقم هاتفك (يجب أن يطابق الرقم المُسجَّل في حسابك على اللوحة).',
      reply_markup: { keyboard: [[{ text: '📱 مشاركة رقمي وربط حسابي', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  } catch (e) { console.warn('telegram welcome:', e.message); }
}

// تسجيل الـ webhook تلقائياً (يُستدعى عند الإقلاع إن توفّر APP_URL)
async function setWebhook(url, secret) {
  if (!enabled || !url) return;
  try { await call('setWebhook', { url, secret_token: secret || undefined, allowed_updates: ['message'] }); console.log('Telegram webhook مسجّل:', url); }
  catch (e) { console.warn('telegram setWebhook:', e.message); }
}

module.exports = { enabled, normPhone, sendMessage, sendWelcome, setWebhook };
