# تشغيل ونشر SECURO

## التشغيل المحلي

ثبّت الحزم:

```bash
npm install
```

جهّز الجداول في Neon مرة واحدة:

```bash
npm run db:init
```

شغّل نسخة التطوير:

```bash
npm run dev
```

ثم افتح:

```text
http://localhost:5000
```

## إنشاء أو تحديث حساب الأدمن

لا تضع كلمة المرور داخل الملفات. نفّذ الأمر مع متغيرات مؤقتة في الطرفية:

```bash
ADMIN_EMAIL=admin@securo.com \
ADMIN_NAME="مدير منصة SECURO" \
ADMIN_PASSWORD="ضع-كلمة-مرور-قوية-هنا" \
npm run admin:create
```

## فحص البناء

```bash
npm run build
```

## إعداد Vercel

اربط المستودع أو المشروع في Vercel، ثم أضف متغيرات البيئة التالية في
`Settings → Environment Variables` لكل من `Preview` و`Production`:

```text
NEON_DATABASE_URL=رابط اتصال Neon
SESSION_SECRET=سر عشوائي طويل
```

إعدادات المشروع الموجودة في `vercel.json` تستخدم:

```text
Build command: npm run build
Function entry: api/index.js
```

بعد إضافة المتغيرات اضغط Deploy. لا تشغّل `npm run db:init` في كل Deploy؛
نفّذه مرة واحدة فقط على قاعدة Neon المطلوبة قبل النشر.

## النشر من Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
vercel --prod
```

أضف المتغيرات من لوحة Vercel أو باستخدام:

```bash
vercel env add NEON_DATABASE_URL production
vercel env add SESSION_SECRET production
```

ثم أعد النشر:

```bash
vercel --prod
```