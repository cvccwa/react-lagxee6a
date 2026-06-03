-- Blood Hunt Gear Optimizer — Batch 1 migration
-- Run this in: Supabase dashboard → SQL Editor → New query

-- ── Tables ────────────────────────────────────────────────────────────────────

create table inventory (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users(id) on delete cascade not null,
  type           text not null check (type in ('Weapon', 'Accessory', 'Exclusive', 'Armor')),
  name           text not null,
  rating         integer not null,
  extended_effects jsonb not null default '[]',
  created_at     timestamptz default now()
);

create table saved_combos (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade not null,
  name       text not null,
  saved_at   text not null,
  weapon     jsonb not null,
  accessory  jsonb not null,
  exclusive  jsonb not null,
  created_at timestamptz default now()
);

create table user_config (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade not null unique,
  skills     jsonb not null default '{}',
  reqs       jsonb not null default '{}',
  updated_at timestamptz default now()
);

create table api_key_status (
  id               uuid default gen_random_uuid() primary key,
  user_id          uuid references auth.users(id) on delete cascade not null unique,
  gemini_saved     boolean default false,
  anthropic_saved  boolean default false,
  scan_provider    text default 'gemini',
  updated_at       timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table inventory       enable row level security;
alter table saved_combos    enable row level security;
alter table user_config     enable row level security;
alter table api_key_status  enable row level security;

-- Inventory
create policy "Users can read own inventory"   on inventory for select using (auth.uid() = user_id);
create policy "Users can insert own inventory" on inventory for insert with check (auth.uid() = user_id);
create policy "Users can update own inventory" on inventory for update using (auth.uid() = user_id);
create policy "Users can delete own inventory" on inventory for delete using (auth.uid() = user_id);

-- Saved combos
create policy "Users can read own combos"   on saved_combos for select using (auth.uid() = user_id);
create policy "Users can insert own combos" on saved_combos for insert with check (auth.uid() = user_id);
create policy "Users can update own combos" on saved_combos for update using (auth.uid() = user_id);
create policy "Users can delete own combos" on saved_combos for delete using (auth.uid() = user_id);

-- User config
create policy "Users can read own config"   on user_config for select using (auth.uid() = user_id);
create policy "Users can insert own config" on user_config for insert with check (auth.uid() = user_id);
create policy "Users can update own config" on user_config for update using (auth.uid() = user_id);

-- API key status
create policy "Users can read own key status"   on api_key_status for select using (auth.uid() = user_id);
create policy "Users can insert own key status" on api_key_status for insert with check (auth.uid() = user_id);
create policy "Users can update own key status" on api_key_status for update using (auth.uid() = user_id);

-- ── Vault (for API key storage in Phase 3) ───────────────────────────────────

create extension if not exists supabase_vault;
