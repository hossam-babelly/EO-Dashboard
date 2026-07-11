package com.sankari.eodashboard;

// ============================================================================
//  EO-Dashboard — غلاف أندرويد (الحزمة 33)
//  WebView صرف يحتضن المنصّة الحيّة على Render — نفس الرابط ونفس قاعدة البيانات:
//  أي تغيير من التطبيق يظهر على الرابط فوراً والعكس (لا تخزين محلي للبيانات).
//  الجسر AndroidBridge (يقرؤه app.js/report.js/login.html):
//    saveBase64(name, mime, b64)  حفظ تقارير PDF/Word/Excel في «التنزيلات» + إشعار يفتح الملف
//    setAppName(name)             الاسم الديناميكي (من إعدادات المدير) في شاشة المهام
//    getVersion()                 إصدار التطبيق المثبَّت (لشارات الإصدار في الواجهة)
//    retry()                      إعادة المحاولة من صفحة انقطاع الاتصال
// ============================================================================

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://project-form-o7sl.onrender.com/";
    private static final String APP_HOST = "project-form-o7sl.onrender.com";
    private static final int FILE_CHOOSER_CODE = 41;
    private static final int STORAGE_PERM_CODE = 42;
    private static final int NOTIF_PERM_CODE = 43;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    // ملف معلّق بانتظار إذن التخزين (أندرويد 9 وأقدم فقط)
    private String pendingName, pendingMime;
    private byte[] pendingData;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        // إذن الإشعارات (أندرويد 13+) — لإشعار «حُفظ التقرير، اضغط للفتح»
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{ android.Manifest.permission.POST_NOTIFICATIONS }, NOTIF_PERM_CODE);
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage (التصميم/اللغة/إعدادات العرض)
        s.setDatabaseEnabled(true);
        // ⚠️ حرج (درس Pro-Dashboard 102 — السبب الجذري لتجاوز النوافذ عرضَ الشاشة والتمرير الأفقي):
        // UseWideViewPort=true يوسّع «الشاشة المنطقية» إلى عرض أعرض محتوى (الجداول)
        // فتُحسب كل قياسات CSS (100vw والنوافذ والطبقات الثابتة) على عرضٍ أكبر من الشاشة.
        // false = تثبيت الشاشة المنطقية على عرض شاشة الهاتف تماماً كما في متصفح الهاتف.
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);

        // كوكي الجلسة الموقّع يبقى بين فتحات التطبيق — نفس جلسة الرابط (7 أيام)
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                // صفحات المنصّة تبقى داخل التطبيق؛ أي رابط خارجي (مرفقات Drive، تيليجرام…) يُفتح في متصفّح الهاتف
                if (APP_HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOfflinePage();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // رفع المرفقات (📎): <input type="file"> داخل WebView يحتاج هذا المعالج
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, getString(R.string.choose_file)), FILE_CHOOSER_CODE);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // التنزيلات المباشرة من الخادم (مثل ملف التقويم ICS) عبر مدير تنزيلات النظام.
        // (تقارير PDF/Excel روابط blob لا تصل هنا — تمرّ عبر الجسر saveBase64.)
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            if (!url.startsWith("http")) return;
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) r.addRequestHeader("cookie", cookies); // الجلسة (التنزيلات المحمية تتطلّب دخولاً)
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
                toast(getString(R.string.downloading));
            } catch (Exception e) {
                toast(getString(R.string.download_failed));
            }
        });

        if (savedInstanceState == null) web.loadUrl(APP_URL);
        else web.restoreState(savedInstanceState);
    }

    // ------------------------------ الجسر ------------------------------
    private class Bridge {
        @JavascriptInterface
        public void saveBase64(final String name, final String mime, final String b64) {
            try {
                final byte[] data = Base64.decode(b64, Base64.DEFAULT);
                runOnUiThread(() -> saveToDownloads(name, mime, data));
            } catch (Exception e) {
                runOnUiThread(() -> toast(getString(R.string.download_failed)));
            }
        }

        @JavascriptInterface
        public void setAppName(final String name) {
            if (name == null || name.trim().isEmpty()) return;
            runOnUiThread(() -> {
                try { setTaskDescription(new ActivityManager.TaskDescription(name.trim())); } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(APP_URL));
        }

        // إصدار التطبيق المثبَّت — تعرضه الواجهة (شاشة الدخول وقائمة ⌄) لتشخيص أي جهاز فوراً
        @JavascriptInterface
        public String getVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return ""; }
        }
    }

    // ------------------------------ حفظ الملفات ------------------------------
    private void saveToDownloads(String name, String mime, byte[] data) {
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingName = name; pendingMime = mime; pendingData = data;
            requestPermissions(new String[]{ android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, STORAGE_PERM_CODE);
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                // أندرويد 10+: MediaStore يكتب في «التنزيلات» بلا أي إذن
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("insert failed");
                try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(data); }
                // حفظ فقط بلا مشاركة تلقائية (قرار المالك) + إشعار يُفتح منه الملف
                toast(getString(R.string.saved_downloads, name));
                notifySaved(uri, mime, name);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(data); }
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE))
                        .addCompletedDownload(f.getName(), f.getName(), true, mime, f.getAbsolutePath(), f.length(), true);
                toast(getString(R.string.saved_downloads, name));
            }
        } catch (Exception e) {
            toast(getString(R.string.download_failed));
        }
    }

    // إشعار «حُفظ الملف» — النقر عليه يفتح الملف بالتطبيق المناسب.
    // (على أندرويد 9 وأقدم يعرض مدير التنزيلات إشعاره الخاص عبر addCompletedDownload.)
    private void notifySaved(Uri uri, String mime, String name) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel(
                        "downloads", getString(R.string.channel_downloads), NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = new Intent(Intent.ACTION_VIEW);
            open.setDataAndType(uri, mime);
            open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            int reqId = (int) (System.currentTimeMillis() & 0x0fffffff);
            PendingIntent pi = PendingIntent.getActivity(this, reqId, open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, "downloads")
                    : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle(name)
                    .setContentText(getString(R.string.tap_to_open))
                    .setContentIntent(pi)
                    .setAutoCancel(true);
            nm.notify(reqId, b.build());
        } catch (Exception ignored) { }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == STORAGE_PERM_CODE && pendingData != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                saveToDownloads(pendingName, pendingMime, pendingData);
            } else {
                toast(getString(R.string.download_failed));
            }
            pendingName = null; pendingMime = null; pendingData = null;
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_CODE && filePathCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{ data.getData() };
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ------------------------------ صفحة الانقطاع ------------------------------
    private void showOfflinePage() {
        String html = "<!doctype html><html dir=\"rtl\" lang=\"ar\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>body{font-family:sans-serif;background:#1E1C1F;color:#F0EDEB;display:flex;flex-direction:column;"
                + "align-items:center;justify-content:center;min-height:92vh;text-align:center;padding:24px;margin:0}"
                + "h2{font-size:20px;margin:0 0 10px}p{color:#DACDC1;font-size:14px;margin:4px 0}"
                + "button{margin-top:20px;padding:12px 34px;border:none;border-radius:12px;background:#B8603C;color:#fff;font-size:15px;font-weight:700}</style></head>"
                + "<body><h2>لا يوجد اتصال بالإنترنت</h2>"
                + "<p>تعذّر الوصول إلى المنصّة. تأكّد من اتصال هاتفك ثم أعد المحاولة.</p>"
                + "<p style=\"direction:ltr\">No internet connection — check your connection and retry.</p>"
                + "<button onclick=\"AndroidBridge.retry()\">إعادة المحاولة / Retry</button></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    // ------------------------------ دورة الحياة ------------------------------
    // زرّ رجوع الهاتف: المنصّة صفحة واحدة (SPA) لا تغيّر تاريخ المتصفح،
    // لذا يُسأل التطبيقُ الصفحةَ أولاً (window.eoAppBack في app.js): تُغلق القائمة/النافذة
    // المفتوحة ('handled')؛ وإلا تاريخ WebView (صفحة الدخول/المستخدمين)؛ وإلا الخروج.
    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript(
                "(function(){try{return window.eoAppBack?window.eoAppBack():'exit'}catch(e){return 'exit'}})()",
                value -> {
                    if (value != null && value.contains("handled")) return; // عولج داخل الصفحة
                    if (web.canGoBack()) web.goBack();
                    else finish();
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // تثبيت كوكي الجلسة على القرص
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }
}
