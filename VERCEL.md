# تشغيل ونشر SECURO

هذا المشروع مقسوم للنشر إلى خدمتين:

1. **Backend على Render** من جذر المستودع.
2. **Frontend على Vercel** من المجلد `attached_assets` كموقع static.

يجب نشر الـ Backend أولاً، لأن رابط Render سيُستخدم في إعداد الـ Frontend.

## 1. تجهيز قاعدة البيانات

يحتاج الـ Backend إلى PostgreSQL. يمكن استخدام Neon كما هو موضح في هذا المشروع.
بعد الحصول على رابط الاتصال، خزّنه في متغير:

```bash
export NEON_DATABASE_URL='postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require'
```

تهيئة الجداول مرة واحدة فقط:

```bash
npm ci
npm run db:init
```

إنشاء حساب المدير:

```bash
ADMIN_EMAIL='admin@example.com' \
ADMIN_NAME='مدير منصة SECURO' \
ADMIN_PASSWORD='ضع-كلمة-مرور-قوية-هنا' \
npm run admin:create
```

لا تضع كلمة المرور أو رابط قاعدة البيانات داخل Git.

## 2. نشر Backend على Render

### الطريقة الأولى: باستخدام `render.yaml`

1. ارفع المستودع إلى GitHub.
2. في Render اختر **New → Blueprint**.
3. اختر المستودع ثم وافق على `render.yaml`.
4. أدخل قيمة `NEON_DATABASE_URL` عندما يطلبها Render.
5. بعد إنشاء الخدمة، انسخ رابطها، مثل:
   `https://securo-backend.onrender.com`.
6. اترك `SESSION_SECRET` بالقيمة التي يولدها Render.
7. عدّل `FRONTEND_URL` لاحقاً بعد نشر Vercel، أو ضع رابط Vercel المتوقع مؤقتاً.

### الطريقة الثانية: إعداد الخدمة يدوياً

أنشئ **Web Service** من المستودع، ثم استخدم:

```text
Root Directory: اتركه فارغاً
Environment: Node
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /api/health
```

أضف متغيرات البيئة التالية في Render:

```text
NODE_ENV=production
NEON_DATABASE_URL=رابط اتصال PostgreSQL
SESSION_SECRET=قيمة عشوائية طويلة
FRONTEND_URL=https://اسم-مشروعك.vercel.app
COOKIE_SAME_SITE=none
```

اختبر الـ Backend بعد النشر:

```bash
curl https://اسم-خدمة-Render.onrender.com/api/health
```

يجب أن تحصل على استجابة JSON ناجحة. أوامر التشغيل والبناء محلياً هي:

```bash
npm install
npm run build
npm start
```

وللتطوير:

```bash
npm run dev
```

## 3. نشر Frontend على Vercel

الـ Frontend الحالي هو ملفات HTML/CSS/JavaScript عادية، لذلك لا يحتاج إلى
React أو خطوة bundling. استخدم المجلد `attached_assets` كجذر مشروع Vercel:

### من لوحة Vercel

1. اختر **Add New → Project** واربط مستودع GitHub.
2. في **Root Directory** اختر `attached_assets`.
3. اختر **Other** كإطار العمل.
4. اترك **Build Command** فارغاً.
5. اترك **Output Directory** فارغاً.
6. اضغط **Deploy**.

### من الطرفية

من جذر المستودع:

```bash
npm install -g vercel
vercel login
vercel --cwd attached_assets
vercel --cwd attached_assets --prod
```

بعد أول نشر، انسخ رابط Vercel النهائي، ثم حدّث في Render:

```text
FRONTEND_URL=https://اسم-مشروعك.vercel.app
```

ثم أعد تشغيل خدمة Render. الكود يستخدم هذا الرابط للسماح بطلبات CORS ولحفظ
جلسة تسجيل الدخول بين نطاق Vercel ونطاق Render.

## 4. ربط Frontend بالـ Backend

تمت إضافة `attached_assets/vercel.json` ليحوّل تلقائياً كل طلب يبدأ بـ
`/api/` من Vercel إلى:

```text
https://securo-backend.onrender.com
```

إذا استخدمت اسم خدمة مختلفاً في Render، افتح هذا الملف وعدّل قيمة
`destination` إلى رابط خدمة Render الحقيقي، ثم أعد النشر:

```bash
vercel --cwd attached_assets --prod
```

بهذا لا تحتاج إلى تغيير كود الواجهة في كل مرة. سيبقى `client-api.js` يستخدم
المسارات النسبية مثل `/api/auth/login`، وVercel سيتولى تمريرها إلى Render.

### خيار بديل: الاتصال المباشر

إذا أردت أن يتصل المتصفح مباشرة بـ Render بدلاً من استخدام rewrite، ضع رابط
Render في أول الملف:

قبل النشر، يجب أن يعرف `client-api.js` رابط Render. في ملف:

```text
attached_assets/client-api.js
```

استبدل:

```js
    "__BACKEND_URL__";
```

برابط خدمة Render:

```js
    "https://اسم-خدمة-Render.onrender.com";
```

ثم ادفع التعديل إلى GitHub وأعد نشر Vercel. إذا كان الـ Frontend والـ Backend
يعملان على نفس النطاق، يمكن ترك القيمة فارغة، لكن في هذا التقسيم يجب استخدام
رابط Render الكامل.

## 5. أوامر التحقق

فحص JavaScript:

```bash
npm run build
```

فحص صحة الـ Backend:

```bash
curl -i https://اسم-خدمة-Render.onrender.com/api/health
```

تشغيل محلي مع قاعدة البيانات:

```bash
NEON_DATABASE_URL='postgresql://...' \
SESSION_SECRET='سر-محلي-طويل' \
FRONTEND_URL='http://localhost:5000' \
npm start
```

ثم افتح:

```text
http://localhost:5000
```

## ملاحظات مهمة

- شغّل `npm run db:init` مرة واحدة فقط لكل قاعدة بيانات، وليس مع كل Deploy.
- لا تستخدم `localhost` كرابط Backend داخل Vercel.
- يجب أن تكون `FRONTEND_URL` مطابقة تماماً لرابط Vercel، بدون `/` في النهاية.
- عند استخدام Preview URL مختلف من Vercel، أضفه إلى `FRONTEND_URL` مفصولاً بفاصلة
  مع الرابط الأساسي.

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