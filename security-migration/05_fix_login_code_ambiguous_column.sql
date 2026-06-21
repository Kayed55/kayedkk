-- ============================================================================
-- المرحلة 5: إصلاح التباس اسم العمود في request_login_code
-- ============================================================================
-- المشكلة (BUG):
--   عند مسار نجاح OTP (بعد اجتياز كلمة المرور) تفشل الدالة بخطأ:
--     42702: column reference "user_id" is ambiguous
--            "It could refer to either a PL/pgSQL variable or a table column."
--
--   السبب: دالة request_login_code تُعرّف عمود إرجاع باسم user_id ضمن
--   RETURNS TABLE(...). داخل الجسم، الجملة:
--       update public.login_codes set used = true
--        where user_id = v_user.id and used = false;
--   تستخدم user_id غير مؤهّل، فيلتبس بين متغيّر الإرجاع user_id وعمود الجدول
--   public.login_codes.user_id. الإعداد الافتراضي plpgsql.variable_conflict
--   = error فيُرمى الخطأ. يظهر في مسار النجاح فقط (المسارات الفاشلة ترجع
--   مبكراً قبل بلوغ هذه الجملة).
--
-- الحل:
--   تأهيل عمود الجدول صراحةً: where public.login_codes.user_id = v_user.id.
--   نسخة معاد إنشاؤها بنفس التوقيع والمنطق و ::text casts (من 04)، مع هذا
--   التأهيل فقط. لا تغيير في أي شيء آخر.
--
-- ملاحظة: هذه علّة كامنة في منطق 02_otp_login.sql الأصلي ظهرت بعد إعادة
--   إنشاء الدالة. verify_login_code لا تتأثّر (أعمدة إرجاعها ok/message/
--   user_data فقط، لا عمود user_id).
-- ============================================================================

begin;

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
  -- ✅ FIX: تأهيل عمود الجدول لتفادي التباس user_id (42702)
  update public.login_codes
     set used = true
   where public.login_codes.user_id = v_user.id
     and used = false;

  -- توليد كود من 6 أرقام (مع padding للأصفار)
  v_code    := lpad(floor(random() * 1000000)::int::text, 6, '0');
  v_expires := now() + interval '5 minutes';

  insert into public.login_codes(user_id, code, expires_at)
  values (v_user.id, v_code, v_expires);

  -- ::text على user_email و user_name (العمودان من varchar(255)) — من 04
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

commit;

-- ============================================================================
-- التحقّق بعد التشغيل (anon، بكلمة مرور صحيحة):
--   select * from public.request_login_code('admin@example.com', '<كلمة صحيحة>');
--   -- المتوقّع: ok=true, user_id, user_email, masked_email, code_to_send=6 أرقام
-- ============================================================================
