-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.websites (
    id uuid primary key,
    title text not null,
    description text not null default '',
    url text not null,
    tags text[] not null default '{}',
    image text not null default '',
    created_at timestamptz not null default now()
);

-- Only the server (with the service key) may touch this table.
alter table public.websites enable row level security;

-- Public bucket for website screenshots (visitors need to see them).
insert into storage.buckets (id, name, public)
values ('portfolio', 'portfolio', true)
on conflict (id) do nothing;
