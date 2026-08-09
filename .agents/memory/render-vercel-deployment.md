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