---
name: Render وVercel deployment
description: قاعدة ربط واجهة Vercel مع Backend Render مع جلسات تسجيل الدخول.
---

عند نشر الواجهة والـ Backend على نطاقين مختلفين، لا يكفي تغيير رابط API؛ يجب
ضبط CORS المسموح، إرسال credentials، وCookie من نوع `SameSite=None` مع `Secure`.

**Why:** تسجيل الدخول يعتمد على جلسة Express محفوظة في Cookie، والمتصفح يمنع
إرسالها عبر النطاقين ما لم تُضبط هذه العناصر معاً.

**How to apply:** عند تغيير رابط خدمة Render أو نطاق Vercel، حدّث رابط rewrite
في إعدادات الواجهة وقيمة `FRONTEND_URL` في Backend معاً، ثم أعد النشر.

عند النشر خارج Replit، يجب أن تكون كل حقول `resolved` في `package-lock.json`
موجهة إلى `https://registry.npmjs.org/`؛ روابط `package-firewall.replit.local`
تعمل داخل Replit فقط وتفشل على Render.

**Why:** `npm ci` على Render يقرأ الروابط المحفوظة في lockfile مباشرة، حتى مع
تحديد registry عام في أمر البناء.

**How to apply:** بعد أي تثبيت حزم داخل Replit، افحص lockfile قبل النشر وابحث عن
`package-firewall.replit.local` واستبدله بروابط npm الرسمية ثم اختبر `npm ci`.