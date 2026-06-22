-- ============================================================================
-- السماح لموظف الجودة (quality_officer) بتعديل قالب التقييم
-- ============================================================================
-- admin_update_criteria: توسيع الدور المسموح من {admin} إلى {admin, quality_officer}.
-- لا تغيير في التوقيع ولا في التحقّق البنيوي. التدقيق بهوية الجلسة الفعلية.
-- ============================================================================

begin;

create or replace function public.admin_update_criteria(
  p_session_token text,
  p_criteria      jsonb
) returns table(ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_sess record; v_actor text;
  v_section jsonb; v_sub jsonb; v_item jsonb; v_n int := 0;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false, 'ليس لديك صلاحية لتعديل المعايير'::text; return; end if;

  -- تحقّق بنيوي
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'object' then return query select false, 'بنية المعايير غير صالحة'::text; return; end if;
  if coalesce(jsonb_typeof(p_criteria->'answers'),'') <> 'object'
     or (p_criteria->'answers'->>'OK') is null or (p_criteria->'answers'->>'ERR') is null or (p_criteria->'answers'->>'NA') is null then
    return query select false, 'إجابات المعايير (OK/ERR/NA) ناقصة'::text; return;
  end if;
  if coalesce(jsonb_typeof(p_criteria->'sections'),'') <> 'array' then
    return query select false, 'يجب وجود أقسام (sections مصفوفة)'::text; return;
  end if;
  if jsonb_array_length(p_criteria->'sections') = 0 then
    return query select false, 'يجب وجود قسم واحد على الأقل'::text; return;
  end if;

  for v_section in select value from jsonb_array_elements(p_criteria->'sections') loop
    v_n := v_n + 1;
    if (v_section->>'key') is null or (v_section->>'type') is null or (v_section->>'weight') is null
       or coalesce(jsonb_typeof(v_section->'subsections'),'') <> 'array' or jsonb_array_length(v_section->'subsections') = 0 then
      return query select false, ('القسم رقم '||v_n||' غير مكتمل (key/type/weight/subsections)')::text; return;
    end if;
    begin perform (v_section->>'weight')::numeric; exception when others then return query select false, ('وزن القسم رقم '||v_n||' ليس رقماً')::text; return; end;
    for v_sub in select value from jsonb_array_elements(v_section->'subsections') loop
      if (v_sub->>'weight') is null or coalesce(jsonb_typeof(v_sub->'items'),'') <> 'array' or jsonb_array_length(v_sub->'items') = 0 then
        return query select false, ('قسم فرعي غير مكتمل (weight/items) في القسم رقم '||v_n)::text; return;
      end if;
      begin perform (v_sub->>'weight')::numeric; exception when others then return query select false, ('وزن قسم فرعي ليس رقماً في القسم رقم '||v_n)::text; return; end;
      for v_item in select value from jsonb_array_elements(v_sub->'items') loop
        if (v_item->>'key') is null or (v_item->>'label') is null then
          return query select false, ('بند غير مكتمل (key/label) في القسم رقم '||v_n)::text; return;
        end if;
      end loop;
    end loop;
  end loop;

  insert into public.criteria_config(config_key, config_value, updated_at, updated_by)
  values('criteria', p_criteria, now(), v_sess.user_id)
  on conflict (config_key) do update set config_value = excluded.config_value, updated_at = now(), updated_by = v_sess.user_id;

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'update_criteria','settings',null,'تحديث معايير التقييم ('||v_n||' أقسام) — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, 'تم حفظ المعايير'::text;
end; $$;

revoke all on function public.admin_update_criteria(text,jsonb) from public;
grant execute on function public.admin_update_criteria(text,jsonb) to anon, authenticated;

commit;
