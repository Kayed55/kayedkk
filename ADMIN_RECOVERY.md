# استرجاع حساب المدير — Admin Recovery

عند فقد الوصول لحساب المدير (نسيان كلمة المرور، أو تعطّل الحساب)، استخدم إحدى الطرق التالية. جميعها تتطلّب وصولاً إلى **Supabase Dashboard** (صاحب المشروع).

> النظام يستخدم مصادقة مخصّصة (جدول `public.users`) وليس Supabase Auth. الأدوار: `admin`, `quality_officer`, `supervisor`, `employee`.

---

## الطريقة 1: إعادة تعيين كلمة مرور مدير موجود (الأسرع)

من **Dashboard → SQL Editor**:
```sql
-- يولّد كلمة مؤقتة ويعيدها لك (نفس دالة لوحة الإدمن)
select * from public.admin_reset_password(
  (select id from public.users where email = 'admin@example.com')
);
-- استخدم temp_password الظاهر للدخول، ثم غيّرها من "الملف الشخصي".
```

## الطريقة 2: إنشاء حساب مدير جديد

```sql
insert into public.users
  (username, password, full_name, email, role, department, position,
   employee_number, is_active, must_change_password, created_at)
values
  ('recovery_admin', 'ChangeMe@2026', 'مدير الطوارئ', 'recovery@company.com',
   'admin', 'الإدارة', 'مدير النظام', 'ADM999', true, true, now());
```
ثم سجّل الدخول بـ `recovery@company.com` / `ChangeMe@2026` وغيّر كلمة المرور فوراً.

## الطريقة 3: إعادة تفعيل حساب معطّل أو ترقيته لمدير

```sql
update public.users
   set is_active = true, role = 'admin', must_change_password = true
 where email = 'someone@company.com';
```

---

## بعد الاسترجاع
1. سجّل الدخول وغيّر كلمة المرور المؤقتة من **الملف الشخصي**.
2. راجع **سجل العمليات** للتأكد من عدم وجود نشاط مشبوه.
3. احذف أي حساب طوارئ مؤقّت لم يعد مطلوباً:
   ```sql
   update public.users set is_active = false where username = 'recovery_admin';
   ```

## تنبيه أمني
كلمات المرور مخزّنة حالياً كنصّ واضح في `users.password` (قيد معروف). لا تشارك لقطات من جدول `users`. خطة التحسين: نقلها إلى تجزئة (pgcrypto) أو Supabase Auth — انظر `docs/SECURITY.md`.
