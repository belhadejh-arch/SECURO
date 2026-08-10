# نشر SECURO على Render وVercel

تم تجهيز المشروع ليُنشر كخدمتين منفصلتين:

1. **Backend على Render Web Service** من جذر المستودع.
2. **Frontend على Vercel** من مجلد `attached_assets`.

## أولاً: قاعدة البيانات

يحتاج الـ Backend إلى PostgreSQL. أضف رابط قاعدة البيانات إلى Render باسم:

```text
NEON_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

هيّئ الجداول مرة واحدة فقط، محلياً أو من Shell في Render:

```bash
npm ci --omit=dev
npm run db:init
```

## Backend على Render

### الإعداد

أنشئ **New → Web Service**، ثم اختر المستودع واضبط:

```text
Root Directory: (فارغ — جذر المستودع)
Runtime: Node
Build Command: npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org/ --replace-registry-host=never && npm run build
Start Command: npm start
Health Check Path: /api/health
```

يمكنك أيضاً اختيار **Blueprint** وسيستخدم Render ملف `render.yaml` الموجود في
المشروع.

### متغيرات البيئة

أضف هذه المتغيرات في Render:

```text
NODE_ENV=production
NEON_DATABASE_URL=رابط PostgreSQL الحقيقي
SESSION_SECRET=قيمة عشوائية طويلة
FRONTEND_URL=https://securo-m9ei-seven.vercel.app
COOKIE_SAME_SITE=none
```

`SESSION_SECRET` يجب ألا يُحفظ في Git. استخدم قيمة مختلفة للإنتاج.

### أوامر Backend المطلوبة

```text
Build Command: npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org/ --replace-registry-host=never && npm run build
Start Command: npm start
```

يشغّل `npm start` الملف `server.js`، ويستمع على المنفذ الذي يقدمه Render عبر
`PORT`.

بعد النشر، اختبر:

```bash
curl -i https://اسم-خدمة-render.onrender.com/api/health
```

## Frontend على Vercel

أنشئ مشروع Vercel من نفس المستودع واضبط:

```text
Root Directory: attached_assets
Framework Preset: Other
Build Command: npm run build
Output Directory: .
Install Command: npm ci
```

يجب أن تكون نسخة Node.js للواجهة `24.x` لأن Vercel لم يعد يقبل
`20.x` للمشاريع الجديدة. الملف `attached_assets/package.json` يحدد ذلك
تلقائياً، كما يثبت `attached_assets/.node-version` الإصدار `24.14.1`.

### أمر التشغيل في Vercel

لا يوجد **Start Command** للواجهة هنا؛ فهي ملفات HTML/CSS/JavaScript ثابتة،
وVercel يخدمها تلقائياً بعد البناء. لذلك يكون الإعداد الصحيح:

```text
Build Command: npm run build
Start Command: غير مطلوب / غير مستخدم في Vercel Static Hosting
```

الـ build الموجود في `attached_assets/package.json` يتحقق من ملفات الواجهة
وصحة JavaScript ولا يحتاج إلى bundler.

## ربط الواجهة بالـ Backend

قبل نشر Vercel، افتح:

```text
attached_assets/vercel.json
```

واستبدل:

```text
https://securo-jmd1.onrender.com
```

برابط خدمة Render الحقيقي، مثل:

```text
https://securo-jmd1.onrender.com
```

> إذا كان اسم خدمة Render مختلفاً، يجب استبدال الرابط الموجود في
> `attached_assets/vercel.json` بالرابط الحقيقي للخدمة قبل نشر Vercel.

بعدها أعد نشر Vercel. ملف `vercel.json` يمرر تلقائياً كل طلب يبدأ بـ `/api/`
إلى Render، لذلك لا نضع رابطاً ثابتاً داخل كود المتصفح.

## الترتيب الصحيح للنشر

1. أنشئ PostgreSQL.
2. شغّل `npm run db:init` مرة واحدة.
3. انشر Backend على Render.
4. انسخ رابط Render.
5. استخدم رابط Render الصحيح `https://securo-jmd1.onrender.com` في `attached_assets/vercel.json`.
6. انشر `attached_assets` على Vercel.
7. اضبط `FRONTEND_URL` في Render على `https://securo-m9ei-seven.vercel.app`.
8. أعد تشغيل Render واختبر تسجيل الدخول.

## أوامر التحقق

من جذر المشروع:

```bash
npm ci
npm run build
```

للتحقق من Frontend فقط:

```bash
cd attached_assets
npm ci
npm run build
```