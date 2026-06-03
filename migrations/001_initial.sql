-- Blood Hunt Gear Optimizer — Batch 1 migration
-- Run this in: Supabase dashboard → SQL Editor → New query

-- Inventory table: one row per user, items stored as JSONB array
create table public.inventories (
  user_id    uuid references auth.users(id) on delete cascade primary key,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- Row-level security: users can only access their own row
alter table public.inventories enable row level security;

create policy "Users can read own inventory"
  on public.inventories for select
  using (auth.uid() = user_id);

create policy "Users can insert own inventory"
  on public.inventories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own inventory"
  on public.inventories for update
  using (auth.uid() = user_id);
