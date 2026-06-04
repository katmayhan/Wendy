-- Wendy database schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor. It creates the tables that store
-- customer records and every Wendy conversation, plus the kit list and checklists.

create extension if not exists pgcrypto;

-- One row per parent/customer.
create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  client_id     text unique not null,         -- anonymous id from the app (until real auth is added)
  auth_user_id  uuid,                          -- link to Supabase Auth later
  email         text,
  name          text,
  due_date      text,
  marketing_opt_in boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Each Wendy conversation (general consult or a specific category).
create table if not exists chats (
  id                 uuid primary key default gen_random_uuid(),
  client_id          text unique not null,
  customer_client_id text not null references customers(client_id) on delete cascade,
  title              text,
  category           text,                     -- null = general consultation
  channel            text default 'message',   -- 'message' | 'voice'
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Every message within a chat.
create table if not exists messages (
  id             uuid primary key default gen_random_uuid(),
  chat_client_id text not null references chats(client_id) on delete cascade,
  role           text not null,                -- 'user' | 'assistant'
  content        text,
  sort_index     int default 0,
  created_at     timestamptz default now()
);

-- The customer's kit list (one row per category they've chosen).
create table if not exists kit_items (
  id                 uuid primary key default gen_random_uuid(),
  customer_client_id text not null references customers(client_id) on delete cascade,
  category           text not null,
  option_id          text,
  option_name        text,
  choice             text,                     -- 'rent' | 'buy'
  verdict            text,                     -- Wendy's honest verdict: 'rent' | 'buy' | 'balanced'
  created_at         timestamptz default now(),
  unique(customer_client_id, category)
);

-- Checklists (hospital bag, newborn essentials, custom).
create table if not exists checklists (
  id                 uuid primary key default gen_random_uuid(),
  customer_client_id text not null references customers(client_id) on delete cascade,
  name               text not null,
  preset             boolean default false,
  created_at         timestamptz default now()
);

create table if not exists checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  text         text not null,
  done         boolean default false,
  note         text,
  sort_index   int default 0
);

create index if not exists idx_chats_customer  on chats(customer_client_id);
create index if not exists idx_messages_chat    on messages(chat_client_id);
create index if not exists idx_kit_customer      on kit_items(customer_client_id);
create index if not exists idx_checklists_customer on checklists(customer_client_id);

-- Row Level Security: lock the tables down. The Netlify data function uses the
-- service-role key, which bypasses RLS, so the app keeps working. Public/anon
-- keys get no access until you add auth-based policies (see DB-SETUP.md).
alter table customers       enable row level security;
alter table chats           enable row level security;
alter table messages        enable row level security;
alter table kit_items       enable row level security;
alter table checklists      enable row level security;
alter table checklist_items enable row level security;

-- When you add Supabase Auth, set customers.auth_user_id on sign-up and add
-- policies such as:
--   create policy "own customer" on customers
--     for all using (auth_user_id = auth.uid());
-- with matching policies on the child tables joined through customer_client_id.
