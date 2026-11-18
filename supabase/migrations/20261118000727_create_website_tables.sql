create table public.websites (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_user_id text not null,
  edition_id text not null,
  name text not null default 'Untitled website',
  draft_content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index websites_owner_idx
  on public.websites(owner_clerk_user_id);

create table public.website_revisions (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null
    references public.websites(id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index revisions_website_idx
  on public.website_revisions(website_id, created_at desc);

alter table public.websites enable row level security;
alter table public.website_revisions enable row level security;

revoke all on public.websites from anon, authenticated;
revoke all on public.website_revisions from anon, authenticated;
