name: الملخص اليومي للمهام

# يرسل ملخص المهام المستحقة كل صباح عبر استدعاء نقطة النهاية على Render.
# يتطلب ضبط سرّين في المستودع: Settings → Secrets and variables → Actions
#   APP_URL      = رابط التطبيق على Render (مثال: https://eo-dashboard.onrender.com)
#   CRON_SECRET  = نفس قيمة CRON_SECRET في متغيّرات بيئة Render

on:
  schedule:
    - cron: '0 5 * * *' # 05:00 UTC = 08:00 بتوقيت دمشق
  workflow_dispatch: {} # تشغيل يدوي عند الحاجة

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - name: استدعاء الملخص اليومي
        run: |
          curl -fsS -X POST "$APP_URL/api/cron/daily-digest" \
            -H "x-cron-secret: $CRON_SECRET" \
            -w "\nHTTP %{http_code}\n"
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
