# Security Migration — Database Patches

سلسلة تصحيحات SQL لقاعدة Supabase الخاصة بنظام الجودة (شركة محزم).
تُشغَّل يدوياً من **Supabase Dashboard → SQL Editor**.

---

## الملفات الموجودة

| الملف | الغرض (جملة واحدة) |
|---|---|
| `01_stop_bleed.sql` | إيقاف تسريب البيانات الحسّاسة عبر مفتاح anon (إجراء طارئ أوّلي). |
| `01b_safe_password_protection.sql` | إنشاء `users_public` (VIEW بدون password) + `verify_login` + `change_password` وسحب `SELECT` من anon عن جدول users. |
| `01c_restore_admin_crud.sql` | استعادة صلاحيات CRUD للإدمن بعد التشديد الأمني. |
| `01d_final_admin_crud_fix.sql` | إصلاح نهائي لصلاحيات الأعمدة (column-level grants) وتعيين `default ''` لعمود password. |
| `02_otp_login.sql` | تسجيل دخول ثنائي عبر البريد (OTP): جدول `login_codes` + `request_login_code` + `verify_login_code` + `cleanup_login_codes`. |
| `02_migrate_to_auth.sql` | مخطّط/تحضير للانتقال المستقبلي إلى Supabase Auth الكامل. |
| `03_password_recovery.sql` | "نسيت كلمة المرور" + إعادة التعيين من لوحة الإدمن: `request_password_reset` + `admin_reset_password`. |
| `04_fix_reset_return_type.sql` | إصلاح خطأ `42804` بتحويل أعمدة varchar إلى `::text` في توقيعات إرجاع `request_password_reset` و `admin_reset_password` و `request_login_code`. |

---

## Rules / قواعد للمستقبل

**EN:** Any `SECURITY DEFINER` RPC returning columns from `public.users` (or any
table with `varchar` columns) **MUST** cast them explicitly in `RETURN QUERY`,
e.g. `v_user.email::text`. PostgreSQL does **NOT** auto-coerce in `RETURNS TABLE`
and will throw `42804 structure of query does not match function result type` on
the **success path only** — making the bug invisible until a real record is
fetched.

**AR:** أي دالة `SECURITY DEFINER` تُعيد أعمدة من `public.users` (أو أي جدول
يحتوي أعمدة `varchar`) **يجب** أن تستخدم `::text` صراحةً على كل عمود في جملة
`RETURN QUERY`، مثل `v_user.email::text`. PostgreSQL لا يحوّل ضمنياً في
`RETURNS TABLE` ويرمي `42804 structure of query does not match function result
type` في **مسار النجاح فقط** — مما يخفي العلّة حتى يُجلب أوّل سجلّ حقيقي.

**الأعمدة المعرّضة في جدول `users`:** `email`, `full_name`, `role`، وأي عمود من
نوع `varchar(N)`.

---

## Deployment order

تُشغَّل الملفات **بالترتيب الرقمي** في Supabase SQL Editor (ألصق محتوى كل ملف ثم
Run):

```
01_stop_bleed.sql
01b_safe_password_protection.sql
01c_restore_admin_crud.sql
01d_final_admin_crud_fix.sql
02_otp_login.sql
02_migrate_to_auth.sql        (اختياري — تحضير مستقبلي)
03_password_recovery.sql
04_fix_reset_return_type.sql
```

كل ملف مغلّف في معاملة (`begin; … commit;`)، وكل دوال RPC تُنشأ بـ
`create or replace` فآمنة لإعادة التشغيل (idempotent).
