-- =============================================================================
-- 07 · Reference data: branches, payment methods, expense categories
-- =============================================================================
-- Names are placeholders the owner can rename from the settings screen.

insert into public.branches (name, is_main, uses_waiters, takes_delivery)
values
  ('Sede principal', true, true, true),
  ('Sede pequeña', false, false, false);

insert into public.payment_methods (code, name, kind, sort_order)
values
  ('cash', 'Efectivo', 'cash', 1),
  ('nequi', 'Nequi', 'digital', 2),
  ('daviplata', 'Daviplata', 'digital', 3),
  ('card', 'Tarjeta', 'digital', 4),
  ('transfer', 'Transferencia', 'digital', 5),
  ('credit', 'Fiado', 'credit', 6);

insert into public.expense_categories (name)
values
  ('Arriendo'),
  ('Servicios públicos'),
  ('Nómina'),
  ('Proveedores'),
  ('Mantenimiento'),
  ('Transporte'),
  ('Otros');
