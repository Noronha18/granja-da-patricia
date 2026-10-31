-- Confirmed catalog only; no real customer data or negotiated price is seeded.
insert into public.products(id,name,eggs_per_tray,default_price_cents) values
('30000000-0000-0000-0000-000000000015','Bandeja de 15',15,1700),
('30000000-0000-0000-0000-000000000020','Bandeja de 20',20,2300),
('30000000-0000-0000-0000-000000000030','Bandeja de 30',30,3300)
on conflict (eggs_per_tray) do nothing;
