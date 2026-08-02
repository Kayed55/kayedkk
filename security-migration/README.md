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

---

## ربط الموظف بالنموذج (RFC #38) — ✅ مكتمل

الهدف: ربط كل موظف بنموذج تقييم مباشر (`users.template_id`)، وتوحيد إدخال النموذج في
الواجهة، واشتقاق «المسمّى الوظيفي» من النموذج، وفلترة الموظفين بالنموذج — مع الحفاظ الكامل
على البيانات التاريخية (`template_snapshot` في التقييمات).

### رحلة الـPRs (#42 → #53)

| PR | المرحلة | الوصف |
|---|---|---|
| #42 | Phase 1 | `users.template_id` (FK) + backfill (56 مرتبط، 4 قيادة NULL) |
| #43 | Phase 2a | `p_template_id` في `create_employee`/`update_employee_profile` (ef) |
| #44 | Phase 2b | `create_weekly_evaluation` يختار عبر template_id (+ fallback) |
| #45 | Phase 2b | `create_evaluation` يختار عبر template_id (+ fallback، فرعا CG+mahzam) |
| #46 | Phase 3-A | dropdown نماذج موحّد في نموذج الموظف (ef) |
| #47 | Phase 3-B | عرض المسمّى مشتقّاً من النموذج (`empRoleDisplay`) |
| #49 | #46b-SQL | `p_template_id` في `admin_create_user`/`admin_update_user` (+ إصلاح ثغرة PUBLIC + باغ فحص القسم) |
| #50 | #46b-UI | dropdown نماذج موحّد في نموذج المستخدم (usr) |
| #51 | Phase 4-A | فلتر «النموذج» في جدول الموظفين |
| #52 | #48-ui | إزالة الكود الميت (~69 سطراً) + بادج slug → اسم النموذج |
| **#53** | **إصلاح جذري** | **كشف `template_id` في `users_public` view** |

### 🎯 SQL 51 (PR #53) — الإصلاح الجذري

pullAll يقرأ view `public.users_public` (لا جدول `users`). الـview (ملف 26) كان يُعدّد
24 عموداً صراحةً **بلا `template_id`** → `DB.data.users.template_id` = `undefined` →
كسر **صامت** لثلاث ميزات دفعةً: فلتر النموذج (F1) + العرض المشتقّ (#47 سقط لـjob_title/«—»)
+ pre-select في نماذج ef/usr. الإصلاح: `CREATE OR REPLACE VIEW` يُلحق `template_id`.
**الكود العميل كان صحيحاً طوال الوقت** — كشفَ السببَ انضباطُ `pg_get_viewdef` (لا تخمين إصلاح عميل).

### جدول المراحل

| Phase | النطاق | الحالة |
|---|---|---|
| 1 | عمود + backfill | ✅ مطبّق (56/4) |
| 2a | RPCs الموظف (ef) | ✅ مطبّق |
| 2b | RPCs التقييم (create_evaluation/weekly) | ✅ مطبّق |
| 3-A | dropdown ef | ✅ منشور |
| 3-B | العرض المشتقّ | ✅ منشور |
| #46b | RPCs + UI المستخدم (usr) | ✅ مطبّق/منشور |
| 4-A | فلتر الموظفين | ✅ منشور |
| #48-ui | تنظيف dead code | ✅ منشور |
| إصلاح 51 | users_public view | ✅ مطبّق |
| 5 (E2E) | subset حرج | ⏳ مؤجّل للمراقبة الإنتاجية |

---

## Backlog مؤجَّل (RFC #38)

- **اختبارات E2E يدوية غير منفَّذة:** T2/T4 (ef) · U1-U3 (usr) · D1/D3 (عرض) · F2-F4 (فلتر).
  (T1 نجح؛ T3/U4/F1/D2 مؤجّلة للمراقبة الإنتاجية بعد إصلاح 51.)
- **Q2-evals + Q3-وسم + #50-p4c:** فلتر التقييمات بالنموذج + وسم «النموذج وقت التقييم»
  من `template_snapshot` — يتطلّب عمود `evaluations.template_id` (schema change). **مؤجّل حتى الحاجة**
  (evaluations تحفظ snapshot audit-safe؛ الرؤية الحالية سليمة).
- **Phase 6:** أرشفة/إسقاط عمود `users.job_role` — **فقط بعد استقرار الإنتاج** والتأكّد أن
  `job_role` المُشتقّ يغطّي كل مسارات الحساب (`compute_task_based`/`role_kpis`).

---

## دروس مستفادة (RFC #38)

1. **Silent rollback (SQL 48/49 أول مرة):** التنفيذ لم يكتمل رغم BEGIN/COMMIT دون خطأ ظاهر.
   → **لزوم استعلام تحقّق بعد كل SQL** (has_param/pub/anon أو matches_repo) قبل التقدّم.
2. **View column omission (SQL 51):** `users_public` view لم يعكس عمود جدول جديد → كسر صامت.
   → **قيمة انضباط `pg_get_functiondef`/`pg_get_viewdef`** (لا تخمين لمتون حيّة؛ كشف السبب الجذري).
3. **PARAMETER مقابل internal read:** الدوال التي **يختار** فيها المستخدم النموذج (create/update
   employee، admin_*) تأخذ `p_template_id` معاملاً؛ الدوال التي **تقرأه** من الموظف
   (create_evaluation/weekly) تقرأ `users.template_id` داخلياً بلا معامل.
4. **DROP+CREATE مقابل CREATE OR REPLACE:** إضافة معامل تُغيّر التوقيع → CREATE OR REPLACE
   يُنشئ overload ثانياً (لبس «not unique») → لزم DROP+CREATE (+ REVOKE/GRANT لأن DROP يعيد
   الصلاحيات للافتراضي). أمّا تغيير جسم دالة بنفس التوقيع (48/49) أو view → CREATE OR REPLACE يكفي.

---

## توصيات المراقبة الإنتاجية (RFC #38)

- راقب **أخطاء Console** في صفحتَي الموظفين والمستخدمين (خاصةً بعد نشر إصلاح 51).
- **أوّل bug ينبثق من F1/T3/U4** → أعد تشغيل الاختبار المتعلّق فوراً (كانت محجوبة بـ51).
- تحقّق دوري: `DB.data.users.filter(u=>u.template_id!=null).length` يعطي رقماً حقيقياً (لا يساوي إجمالي الموظفين — ذلك يعني عودة بق الـview).
