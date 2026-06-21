-- ============================================================================
-- المرحلة 4: إصلاح خطأ نوع الإرجاع في دوال إعادة تعيين كلمة المرور
-- ============================================================================
-- المشكلة (BUG):
--   عند إدخال بريد *مسجّل فعلاً* في "نسيت كلمة المرور" تفشل العملية بخطأ:
--     42804: Returned type character varying(255) does not match
--            expected type text in column 3
--            "structure of query does not match function result type"
--
--   السبب: الدالتان request_password_reset / admin_reset_password تُعرّفان
--   عمودي الإرجاع user_email و user_name كنوع text، بينما العمودان الفعليان
--   public.users.email و public.users.full_name من نوع varchar(255).
--   PostgreSQL صارم في RETURNS TABLE ولا يحوّل تلقائياً، فيرمي الخطأ في
--   مسار النجاح فقط (عند وجود الحساب). لذلك البريد غير المسجّل "يعمل" بينما
--   البريد الحقيقي يفشل دائماً، والواجهة تعرض رسالة عامة "تعذّر إنشاء كلمة المرور".
--
-- الحل:
--   تحويل صريح ::text للقيمتين في جملة return query لكل دالة متأثّرة.
--   لا تغيير في المنطق أو التواقيع أو الصلاحيات.
--
-- ============================================================================
-- جرد شامل (grep: "return query select ... v_user.<عمود>" بدون ::text):
--   1) request_password_reset   03_password_recovery.sql:75   email, full_name  → مُصلَح أدناه
--   2) admin_reset_password      03_password_recovery.sql:129  email, full_name  → مُصلَح أدناه
--   3) request_login_code        02_otp_login.sql:137-138      email, full_name  → مُصلَح أدناه
--        (masked_email في السطر 139-143 مُحوّل أصلاً بـ ::text — سليم)
--   4) verify_login_code         02_otp_login.sql:232          to_jsonb(up.*)    → محصّن (jsonb) لا يحتاج إصلاح
--   لا توجد مواضع أخرى. (cleanup_login_codes / verify_login لا تُعيد أعمدة نصية من users)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) "نسيت كلمة المرور" - عبر البريد
-- ----------------------------------------------------------------------------
create or replace function public.request_password_reset(
  p_email text
) returns table(
  ok          boolean,
  temp_password text,
  user_email  text,
  user_name   text,
  message     text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      public.users;
  v_temp      text;
  v_chars     constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  v_normalized text;
  i           int;
begin
  v_normalized := lower(trim(coalesce(p_email, '')));

  if v_normalized = '' then
    return query select false, null::text, null::text, null::text, 'البريد مطلوب'::text;
    return;
  end if;

  select * into v_user from public.users
   where lower(email) = v_normalized and is_active = true
   limit 1;

  if v_user.id is null then
    return query select false, null::text, null::text, null::text, 'لا يوجد حساب نشط بهذا البريد'::text;
    return;
  end if;

  v_temp := '';
  for i in 1..10 loop
    v_temp := v_temp || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;

  update public.users
     set password             = v_temp,
         must_change_password = true,
         password_reset_at    = now(),
         updated_at           = now()
   where id = v_user.id;

  -- ✅ FIX: تحويل صريح إلى text لتطابق نوع عمودي الإرجاع
  return query select true, v_temp, v_user.email::text, v_user.full_name::text,
                      'تم توليد كلمة مرور مؤقتة'::text;
end;
$$;

revoke all on function public.request_password_reset(text) from public;
grant execute on function public.request_password_reset(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) إعادة تعيين كلمة مرور من لوحة الإدمن - عبر user_id
-- ----------------------------------------------------------------------------
create or replace function public.admin_reset_password(
  p_user_id bigint
) returns table(
  ok          boolean,
  temp_password text,
  user_email  text,
  user_name   text,
  message     text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      public.users;
  v_temp      text;
  v_chars     constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  i           int;
begin
  if p_user_id is null then
    return query select false, null::text, null::text, null::text, 'معرّف المستخدم مطلوب'::text;
    return;
  end if;

  select * into v_user from public.users where id = p_user_id limit 1;

  if v_user.id is null then
    return query select false, null::text, null::text, null::text, 'المستخدم غير موجود'::text;
    return;
  end if;

  v_temp := '';
  for i in 1..10 loop
    v_temp := v_temp || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;

  update public.users
     set password             = v_temp,
         must_change_password = true,
         password_reset_at    = now(),
         updated_at           = now()
   where id = p_user_id;

  -- ✅ FIX: تحويل صريح إلى text لتطابق نوع عمودي الإرجاع
  return query select true, v_temp, v_user.email::text, v_user.full_name::text,
                      'تم إعادة تعيين كلمة المرور'::text;
end;
$$;

revoke all on function public.admin_reset_password(bigint) from public;
grant execute on function public.admin_reset_password(bigint) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) طلب كود OTP — إصلاح وقائي لنفس فخّ النوع (varchar → text)
--    نسخة معاد إنشاؤها بنفس التوقيع والمنطق بالضبط من 02_otp_login.sql،
--    مع ::text على user_email و user_name (masked_email كان محوّلاً أصلاً).
-- ----------------------------------------------------------------------------
create or replace function public.request_login_code(
  p_email    text,
  p_password text
) returns table(
  ok            boolean,
  user_id       bigint,
  user_email    text,
  user_name     text,
  masked_email  text,
  code_to_send  text,
  expires_at    timestamptz,
  message       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        public.users;
  v_code        text;
  v_expires     timestamptz;
  v_normalized  text;
begin
  v_normalized := lower(trim(coalesce(p_email, '')));

  if v_normalized = '' or coalesce(p_password, '') = '' then
    return query select false, null::bigint, null::text, null::text,
                        null::text, null::text, null::timestamptz,
                        'البريد وكلمة المرور مطلوبان'::text;
    return;
  end if;

  select * into v_user
  from public.users
  where lower(email) = v_normalized
    and is_active = true
  limit 1;

  if v_user.id is null then
    return query select false, null::bigint, null::text, null::text,
                        null::text, null::text, null::timestamptz,
                        'بيانات الدخول غير صحيحة'::text;
    return;
  end if;

  if v_user.password is null or v_user.password = '' or v_user.password <> p_password then
    return query select false, null::bigint, null::text, null::text,
                        null::text, null::text, null::timestamptz,
                        'بيانات الدخول غير صحيحة'::text;
    return;
  end if;

  if v_user.email is null or trim(v_user.email) = '' then
    return query select false, null::bigint, null::text, null::text,
                        null::text, null::text, null::timestamptz,
                        'لا يوجد بريد إلكتروني مسجّل لهذا الحساب - تواصل مع الإدارة'::text;
    return;
  end if;

  -- إلغاء أي كود سابق غير مستخدم لنفس المستخدم (كود واحد نشط فقط)
  update public.login_codes
     set used = true
   where user_id = v_user.id
     and used = false;

  -- توليد كود من 6 أرقام (مع padding للأصفار)
  v_code    := lpad(floor(random() * 1000000)::int::text, 6, '0');
  v_expires := now() + interval '5 minutes';

  insert into public.login_codes(user_id, code, expires_at)
  values (v_user.id, v_code, v_expires);

  -- ✅ FIX: ::text على user_email و user_name (العمودان من varchar(255))
  return query select
    true,
    v_user.id,
    v_user.email::text,
    v_user.full_name::text,
    (case
       when position('@' in v_user.email) > 3
       then substr(v_user.email, 1, 2) || '***' || substr(v_user.email, position('@' in v_user.email))
       else v_user.email
     end)::text,
    v_code,
    v_expires,
    'تم إرسال كود الدخول إلى بريدك'::text;
end;
$$;

revoke all on function public.request_login_code(text, text) from public, anon, authenticated;
grant execute on function public.request_login_code(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) verify_login_code — محصّن، لا يحتاج إصلاح.
--    يُعيد user_data كـ jsonb عبر to_jsonb(up.*)، فلا يمرّ أي عمود varchar
--    من users خلال عمود text في RETURNS TABLE. تُرك كما هو عمداً.
-- ----------------------------------------------------------------------------

commit;

-- ============================================================================
-- التحقّق بعد التشغيل (من SQL Editor):
--   select * from public.request_password_reset('admin@example.com');
--   -- المتوقّع: ok=true, temp_password='XXXXXXXXXX', user_email, user_name
-- ============================================================================
