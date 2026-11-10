-- Run once in the Supabase SQL editor.
create table if not exists lbc_items (
  id text primary key,
  type text not null,
  data jsonb not null,
  created_at timestamptz default now()
);
create index if not exists lbc_items_type on lbc_items(type);
-- Row level security on, no public policies: only the server's secret key can read or write.
alter table lbc_items enable row level security;
