-- StudioMaster — Supabase schema (docs §6.5)
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
--
-- Model:
--   * A STUDIO is a user account (Supabase Auth email/password).
--   * A WORKSPACE groups several studios so they share one knowledge base.
--   * podcast_notes + known_issues are scoped to a workspace; Row-Level Security
--     lets a user touch only rows in workspaces they belong to.
--   * Joining is by a short join_code, handled by SECURITY DEFINER functions so
--     the RLS policies stay simple.

create extension if not exists pgcrypto;

-- ── tables ──────────────────────────────────────────────────────────────────
create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner      uuid not null references auth.users (id) on delete cascade,
  join_code  text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  email        text,
  studio_name  text,
  role         text not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.podcast_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  podcast_name text not null,
  notes        text not null default '',
  updated_at   timestamptz not null default now(),
  author       text,
  unique (workspace_id, podcast_name)
);

create table if not exists public.known_issues (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title        text not null,
  symptom      text not null default '',
  fix          text not null default '',
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  author       text
);

-- ── membership helper (avoids RLS recursion) ────────────────────────────────
create or replace function public.is_member(p_workspace uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = auth.uid()
  );
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.podcast_notes     enable row level security;
alter table public.known_issues      enable row level security;

drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select using (public.is_member(id));

drop policy if exists wm_select on public.workspace_members;
create policy wm_select on public.workspace_members for select using (public.is_member(workspace_id));

drop policy if exists pn_all on public.podcast_notes;
create policy pn_all on public.podcast_notes for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

drop policy if exists ki_all on public.known_issues;
create policy ki_all on public.known_issues for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- ── RPCs the app calls ──────────────────────────────────────────────────────
-- Create a workspace and add the caller as its owner. Returns id + join_code.
create or replace function public.create_workspace(p_name text, p_studio text default null)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare w public.workspaces;
begin
  insert into public.workspaces (name, owner) values (p_name, auth.uid()) returning * into w;
  insert into public.workspace_members (workspace_id, user_id, email, studio_name, role)
    values (w.id, auth.uid(), (auth.jwt() ->> 'email'), coalesce(p_studio, p_name), 'owner');
  return w;
end; $$;

-- Join an existing workspace by its join_code. Returns the workspace.
create or replace function public.join_workspace(p_code text, p_studio text default null)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare w public.workspaces;
begin
  select * into w from public.workspaces where join_code = p_code;
  if w.id is null then raise exception 'invalid join code'; end if;
  insert into public.workspace_members (workspace_id, user_id, email, studio_name, role)
    values (w.id, auth.uid(), (auth.jwt() ->> 'email'), coalesce(p_studio, (auth.jwt() ->> 'email')), 'member')
    on conflict (workspace_id, user_id) do update set studio_name = excluded.studio_name;
  return w;
end; $$;

-- Workspaces the caller belongs to, with their role.
create or replace function public.my_workspaces()
returns table (id uuid, name text, join_code text, role text)
language sql security definer set search_path = public as $$
  select w.id, w.name, w.join_code, m.role
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by w.created_at;
$$;

grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.join_workspace(text, text) to authenticated;
grant execute on function public.my_workspaces() to authenticated;
