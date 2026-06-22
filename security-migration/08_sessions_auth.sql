-- ============================================================================
-- المرحلة 1 (أمان): بنية المصادقة عبر رمز جلسة من الخادم (Session Token)
-- ============================================================================
-- الهدف: هوية موثوقة على الخادم. عند نجاح OTP يُصدَر رمز جلسة عشوائي يُخزَّن في
--   جدول sessions، وكل دالة حسّاسة (لاحقاً) تتحقّق منه عبر verify_session وتأخذ
--   الدور الحقيقي من الجلسة قبل التنفيذ.
--
-- ملاحظة: users.id = bigint، لذلك sessions.user_id = bigint (FK صحيح)،
--   و sessions.id = uuid (معرّف الجلسة).
-- توافق خلفي: verify_login_code يُبقي (ok, message, user_data) ويضيف
--   (session_token, session_expires_at) فقط، فلا تنكسر الواجهة الحالية.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) جدول الجلسات
-- ----------------------------------------------------------------------------
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      bigint not null references public.users(id) on delete cascade,
  role         text not null,
  token        text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz not null default now(),
  user_agent   text,
  ip_address   text
);

create index if not exists idx_sessions_token   on public.sessions(token);
create index if not exists idx_sessions_user     on public.sessions(user_id);
create index if not exists idx_sessions_expires  on public.sessions(expires_at);

-- لا وصول مباشر — فقط عبر دوال SECURITY DEFINER
alter table public.sessions enable row level security;
revoke all on public.sessions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) التحقّق من الجلسة — تُستدعى داخل كل دالة حسّاسة (وأيضاً من العميل للفحص)
-- ----------------------------------------------------------------------------
create or replace function public.verify_session(
  p_token text
) returns table(
  user_id   bigint,
  role      text,
  is_valid  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.sessions;
begin
  if p_token is null or trim(p_token) = '' then
    return query select null::bigint, null::text, false; return;
  end if;

  select * into v_sess from public.sessions where token = p_token;

  if v_sess.id is null or v_sess.expires_at < now() then
    return query select null::bigint, null::text, false; return;
  end if;

  -- تجديد آخر استخدام (نشاط)
  update public.sessions set last_used_at = now() where id = v_sess.id;

  return query select v_sess.user_id, v_sess.role::text, true;
end;
$$;

revoke all on function public.verify_session(text) from public;
grant execute on function public.verify_session(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) تنظيف الجلسات المنتهية (اختياري عبر cron)
-- ----------------------------------------------------------------------------
create or replace function public.cleanup_sessions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted int;
begin
  delete from public.sessions where expires_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_sessions() from public;
grant execute on function public.cleanup_sessions() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) verify_login_code — يُصدر رمز جلسة عند النجاح (توافق خلفي بأعمدة إضافية)
--    (تغيير توقيع الإرجاع يتطلّب DROP ثم CREATE)
-- ----------------------------------------------------------------------------
drop function if exists public.verify_login_code(bigint, text);

create function public.verify_login_code(
  p_user_id bigint,
  p_code    text
) returns table(
  ok                  boolean,
  message             text,
  user_data           jsonb,
  session_token       text,
  session_expires_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row          public.login_codes;
  v_user         record;
  v_role         text;
  v_token        text;
  v_expires      timestamptz;
  v_max_attempts constant int := 3;
begin
  if p_user_id is null or p_code is null or trim(p_code) = '' then
    return query select false, 'بيانات ناقصة'::text, null::jsonb, null::text, null::timestamptz; return;
  end if;

  select * into v_row
  from public.login_codes
  where user_id = p_user_id and used = false
  order by created_at desc
  limit 1;

  if v_row.id is null then
    return query select false, 'لا يوجد كود فعّال - اطلب كوداً جديداً'::text, null::jsonb, null::text, null::timestamptz; return;
  end if;

  if v_row.expires_at < now() then
    update public.login_codes set used = true where id = v_row.id;
    return query select false, 'انتهت صلاحية الكود - اطلب كوداً جديداً'::text, null::jsonb, null::text, null::timestamptz; return;
  end if;

  if v_row.attempts >= v_max_attempts then
    update public.login_codes set used = true where id = v_row.id;
    return query select false, 'تم تجاوز عدد المحاولات - اطلب كوداً جديداً'::text, null::jsonb, null::text, null::timestamptz; return;
  end if;

  update public.login_codes set attempts = attempts + 1 where id = v_row.id;

  if trim(p_code) <> v_row.code then
    return query select
      false,
      ('كود غير صحيح - باقي ' || greatest(0, v_max_attempts - (v_row.attempts + 1))::text || ' محاولة')::text,
      null::jsonb, null::text, null::timestamptz;
    return;
  end if;

  -- نجاح: اختم الكود، حدّث آخر دخول، أصدر جلسة
  update public.login_codes set used = true where id = v_row.id;
  update public.users set last_login_at = now(), updated_at = now() where id = p_user_id;

  select role::text into v_role from public.users where id = p_user_id;
  v_token   := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + interval '7 days';

  insert into public.sessions(id, user_id, role, token, created_at, expires_at, last_used_at)
  values (gen_random_uuid(), p_user_id, coalesce(v_role,'employee'), v_token, now(), v_expires, now());

  select to_jsonb(up.*) into v_user from public.users_public up where up.id = p_user_id;

  return query select true, 'تم تأكيد الدخول بنجاح'::text, v_user.to_jsonb, v_token, v_expires;
end;
$$;

revoke all on function public.verify_login_code(bigint, text) from public;
grant execute on function public.verify_login_code(bigint, text) to anon, authenticated;

commit;

-- ============================================================================
-- التحقّق:
--   select * from public.verify_session('badtoken');  -- is_valid=false
--   (تدفّق كامل: request_login_code → verify_login_code → يُرجع session_token)
-- ============================================================================
