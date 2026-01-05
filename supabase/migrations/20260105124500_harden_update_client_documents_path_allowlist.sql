set search_path = public;

/*
  Harden existing update_client_documents RPC.
  - Keep signature + return type (void) to avoid breaking existing callers.
  - Add strict validation of document metadata payloads (array + client-scoped paths).
*/

create or replace function public.update_client_documents(p_client_id uuid, p_documents jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_doc jsonb;
  v_path text;
  v_prefix text;
begin
  -- Check if user can access client documents
  if not can_access_client_documents(p_client_id) then
    raise exception 'You do not have permission to update documents for this client';
  end if;

  if jsonb_typeof(p_documents) <> 'array' then
    raise exception 'documents must be a JSON array';
  end if;

  v_prefix := 'clients/' || p_client_id::text || '/';

  for v_doc in select value from jsonb_array_elements(p_documents) as value loop
    v_path := v_doc->>'path';
    if v_path is null or position(v_prefix in v_path) <> 1 then
      raise exception 'Invalid document path';
    end if;
    if v_path like '%..%' then
      raise exception 'Invalid document path';
    end if;
  end loop;

  -- Update client documents
  update clients
  set documents = p_documents,
      updated_at = now()
  where id = p_client_id;
end;
$function$;

