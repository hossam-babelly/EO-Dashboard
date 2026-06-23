name: نبضة التذكيرات

# تستدعي نقطة نهاية التذكيرات على Render كل ٥ دقائق، فتصل تذكيرات البريد/تيليجرام
# في أوقاتها المضبوطة حتى دون فتح اللوحة. (الحد الأدنى لجدولة GitHub هو ٥ دقائق،
# وقد يتأخر التنفيذ بضع دقائق وقت الذروة. لدقّة أعلى — كل دقيقة — استخدم cron-job.org،
# انظر README.) يتطلب السرّين: APP_URL و CRON_SECRET في إعدادات المستودع.

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch: {}

jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: استدعاء نبضة التذكيرات
        run: |
          curl -fsS -X POST "$APP_URL/api/cron/reminders" \
            -H "x-cron-secret: $CRON_SECRET" \
            -w "\nHTTP %{http_code}\n"
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
