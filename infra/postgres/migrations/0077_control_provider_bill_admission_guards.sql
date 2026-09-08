create function validate_control_gross_approval_cap() returns trigger language plpgsql as $$
begin
  if new.amount_basis = 'GROSS_BILLED_TOTAL_PER_CHARGE' and new.action in ('APPROVE','APPROVE_WITH_CAP')
    and (new.approved_cap_minor is null or new.approved_cap_minor <= 0) then
    raise exception 'A new gross billed approval requires a positive non-null approved cap.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger control_gross_approval_cap before insert on commitment_control_decisions
  for each row execute function validate_control_gross_approval_cap();

create function require_control_provider_bill_authority(workspace_id_value uuid, authorizer_id uuid, selector_id uuid)
returns void language plpgsql as $$
begin
  perform member.user_id from users actor
    join workspace_members member on member.user_id = actor.id and member.workspace_id = workspace_id_value
    where actor.id = authorizer_id and actor.deleted_at is null and member.role in ('owner','admin')
    for share of actor, member;
  if not found then
    raise exception 'New provider bill admission requires a live original source grant authorizer.' using errcode = '23514';
  end if;
  perform member.user_id from users actor
    join workspace_members member on member.user_id = actor.id and member.workspace_id = workspace_id_value
    where actor.id = selector_id and actor.deleted_at is null and member.role in ('owner','admin')
    for share of actor, member;
  if not found then
    raise exception 'New provider bill admission requires a live selecting owner or admin.' using errcode = '23514';
  end if;
end;
$$;

create function validate_recovery_provider_bill_authority() returns trigger language plpgsql as $$
begin
  perform require_control_provider_bill_authority(new.workspace_id, new.consent_authorized_by_user_id, new.selected_by_user_id);
  return new;
end;
$$;

create trigger recovery_provider_bill_authority before insert on recovery_provider_bill_links
  for each row execute function validate_recovery_provider_bill_authority();

create function validate_control_provider_comparison_admission() returns trigger language plpgsql as $$
declare authorizer_id uuid; frozen_cap_minor bigint;
begin
  if new.comparison_kind = 'BILLED_AMOUNT_COMPARISON' then
    select admitted.consent_authorized_by_user_id, decision.approved_cap_minor into authorizer_id, frozen_cap_minor
    from commitment_control_decisions decision
      join recovery_provider_bill_links admitted
        on admitted.workspace_id = decision.workspace_id and admitted.evidence_id = new.evidence_id
      where decision.workspace_id = new.workspace_id and decision.id = new.decision_id
        and decision.proposal_id = new.proposal_id
        and admitted.source_observed_at >= decision.decided_at;
    if not found then
      raise exception 'A new billed comparison requires source observation at or after the frozen authorization decision.' using errcode = '23514';
    end if;
    if frozen_cap_minor is null or frozen_cap_minor <= 0 or new.approved_cap_minor is null or new.approved_cap_minor <= 0 then
      raise exception 'A new billed comparison requires a positive non-null frozen approved cap.' using errcode = '23514';
    end if;
    perform require_control_provider_bill_authority(new.workspace_id, authorizer_id, new.reconciled_by_user_id);
  end if;
  return new;
end;
$$;

create trigger control_provider_comparison_admission before insert on commitment_control_reconciliations
  for each row execute function validate_control_provider_comparison_admission();
