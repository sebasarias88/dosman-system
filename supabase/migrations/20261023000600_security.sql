-- =============================================================================
-- 06 · Security: privileges and Row Level Security policies
-- =============================================================================
-- Rules applied here:
--   * anon (not signed in) can do nothing at all.
--   * Every policy is per action (select / insert / update / delete), never ALL.
--   * `(select private.fn())` is wrapped in a sub-select so Postgres evaluates
--     it once per query instead of once per row (much faster).
--   * Transactional tables (orders, payments, cash, stock, transfers...) have
--     SELECT policies only. Writes will be added as security-definer RPCs in
--     each feature branch, so the app can never bypass the business rules.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Least privilege for API roles
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke select on all tables in schema public from anon;

alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges in schema public
  revoke select on tables from anon;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- Helper functions: only the ones used inside policies are callable by signed-in users.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.current_app_role(),
  private.current_branch_id(),
  private.is_staff(),
  private.is_owner(),
  private.is_manager(),
  private.can_access_branch(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.add_ons enable row level security;
alter table public.product_add_ons enable row level security;
alter table public.supplies enable row level security;
alter table public.recipe_items enable row level security;
alter table public.payment_methods enable row level security;
alter table public.expense_categories enable row level security;
alter table public.supply_stock enable row level security;
alter table public.stock_movements enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
alter table public.zones enable row level security;
alter table public.dining_tables enable row level security;
alter table public.customers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.customer_payments enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;
alter table public.notification_outbox enable row level security; -- no policies: server only
alter table public.push_subscriptions enable row level security;
alter table public.monthly_summaries enable row level security;

-- -----------------------------------------------------------------------------
-- Settings and branches
-- -----------------------------------------------------------------------------
create policy app_settings_select_staff on public.app_settings
  for select to authenticated using ((select private.is_staff()));
create policy app_settings_update_owner on public.app_settings
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));

create policy branches_select_staff on public.branches
  for select to authenticated using ((select private.is_staff()));
create policy branches_update_owner on public.branches
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));

-- -----------------------------------------------------------------------------
-- Profiles: everyone reads their own; managers read all staff.
-- Creating and editing staff goes through the owner-only server endpoint.
-- -----------------------------------------------------------------------------
create policy profiles_select_self_or_manager on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_manager()));

-- -----------------------------------------------------------------------------
-- Catalog: all active staff read; managers write.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'products', 'product_variants', 'add_ons', 'product_add_ons',
    'supplies', 'recipe_items', 'payment_methods', 'expense_categories',
    'zones', 'dining_tables'
  ]
  loop
    execute format(
      'create policy %1$s_select_staff on public.%1$I for select to authenticated using ((select private.is_staff()))', t);
    execute format(
      'create policy %1$s_insert_manager on public.%1$I for insert to authenticated with check ((select private.is_manager()))', t);
    execute format(
      'create policy %1$s_update_manager on public.%1$I for update to authenticated using ((select private.is_manager())) with check ((select private.is_manager()))', t);
    execute format(
      'create policy %1$s_delete_manager on public.%1$I for delete to authenticated using ((select private.is_manager()))', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Branch-scoped read-only tables (writes only through RPCs)
-- -----------------------------------------------------------------------------
create policy supply_stock_select_branch on public.supply_stock
  for select to authenticated using ((select private.can_access_branch(branch_id)));
-- Managers may tune the low-stock threshold per branch (not the quantity: that comes from movements).
create policy supply_stock_update_manager on public.supply_stock
  for update to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));

create policy stock_movements_select_branch on public.stock_movements
  for select to authenticated using ((select private.can_access_branch(branch_id)));

create policy purchases_select_branch on public.purchases
  for select to authenticated using ((select private.can_access_branch(branch_id)));
create policy purchase_items_select_branch on public.purchase_items
  for select to authenticated using (
    exists (select 1 from public.purchases p
            where p.id = purchase_id and (select private.can_access_branch(p.branch_id)))
  );

create policy suppliers_select_staff on public.suppliers
  for select to authenticated using ((select private.is_staff()));
create policy suppliers_insert_manager on public.suppliers
  for insert to authenticated with check ((select private.is_manager()));
create policy suppliers_update_manager on public.suppliers
  for update to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));

create policy supplier_payments_select_manager on public.supplier_payments
  for select to authenticated using ((select private.is_manager()));

-- Transfers are visible to both the sending and the receiving branch.
create policy transfers_select_branch on public.transfers
  for select to authenticated using (
    (select private.can_access_branch(from_branch_id)) or (select private.can_access_branch(to_branch_id))
  );
create policy transfer_items_select_branch on public.transfer_items
  for select to authenticated using (
    exists (select 1 from public.transfers t
            where t.id = transfer_id
              and ((select private.can_access_branch(t.from_branch_id))
                   or (select private.can_access_branch(t.to_branch_id))))
  );

create policy inventory_counts_select_branch on public.inventory_counts
  for select to authenticated using ((select private.can_access_branch(branch_id)));
create policy inventory_count_items_select_branch on public.inventory_count_items
  for select to authenticated using (
    exists (select 1 from public.inventory_counts c
            where c.id = count_id and (select private.can_access_branch(c.branch_id)))
  );

create policy cash_sessions_select_branch on public.cash_sessions
  for select to authenticated using ((select private.can_access_branch(branch_id)));
create policy cash_movements_select_branch on public.cash_movements
  for select to authenticated using ((select private.can_access_branch(branch_id)));

create policy orders_select_branch on public.orders
  for select to authenticated using ((select private.can_access_branch(branch_id)));
create policy order_items_select_branch on public.order_items
  for select to authenticated using ((select private.can_access_branch(branch_id)));
create policy payments_select_branch on public.payments
  for select to authenticated using ((select private.can_access_branch(branch_id)));
create policy customer_payments_select_branch on public.customer_payments
  for select to authenticated using ((select private.can_access_branch(branch_id)));

-- Customers are shared (a delivery client may also buy at the counter).
create policy customers_select_staff on public.customers
  for select to authenticated using ((select private.is_staff()));
create policy customers_update_manager on public.customers
  for update to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));

-- -----------------------------------------------------------------------------
-- Expenses: managers see everything; staff only see the expenses they entered
-- (rent and payroll stay private to the owners).
-- -----------------------------------------------------------------------------
create policy expenses_select_manager_or_author on public.expenses
  for select to authenticated using (
    (select private.is_manager()) or created_by = (select auth.uid())
  );
create policy expenses_insert_manager on public.expenses
  for insert to authenticated with check ((select private.is_manager()) and cash_session_id is null);

create policy recurring_expenses_select_manager on public.recurring_expenses
  for select to authenticated using ((select private.is_manager()));
create policy recurring_expenses_insert_manager on public.recurring_expenses
  for insert to authenticated with check ((select private.is_manager()));
create policy recurring_expenses_update_manager on public.recurring_expenses
  for update to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));
create policy recurring_expenses_delete_manager on public.recurring_expenses
  for delete to authenticated using ((select private.is_manager()));

-- -----------------------------------------------------------------------------
-- Audit and summaries: managers only.
-- -----------------------------------------------------------------------------
create policy audit_log_select_manager on public.audit_log
  for select to authenticated using ((select private.is_manager()));

create policy monthly_summaries_select_manager on public.monthly_summaries
  for select to authenticated using ((select private.is_manager()));

-- -----------------------------------------------------------------------------
-- Push subscriptions: each person manages their own devices.
-- -----------------------------------------------------------------------------
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (profile_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (profile_id = (select auth.uid()) and (select private.is_staff()));
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (profile_id = (select auth.uid()));
