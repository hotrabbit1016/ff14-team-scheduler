create table if not exists teams (
  id text primary key,
  public_slug text not null unique,
  name text not null,
  content_name text not null default '',
  team_mode text not null default 'prog' check (team_mode in ('reclear', 'prog', 'ultimate', 'flexible')),
  party_size integer not null default 8 check (party_size = 8),
  role_requirements jsonb not null default '{"MT":1,"ST":1,"H1":1,"H2":1,"D1":1,"D2":1,"D3":1,"D4":1}'::jsonb,
  timezone text not null default 'Asia/Taipei',
  target_sessions_per_week integer not null default 2 check (target_sessions_per_week between 1 and 7),
  session_length_minutes integer not null check (session_length_minutes in (90, 120, 150, 180)),
  session_length_meals integer not null default 4 check (session_length_meals in (3, 4, 5, 6)),
  overtime_minutes integer not null default 0 check (overtime_minutes in (0, 30, 60)),
  overtime_meals integer not null default 0 check (overtime_meals in (0, 1, 2)),
  preferred_windows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id text primary key,
  team_id text not null references teams(id) on delete cascade,
  display_name text not null,
  role text not null default 'D1' check (role in ('MT', 'ST', 'H1', 'H2', 'D1', 'D2', 'D3', 'D4')),
  jobs text not null default '',
  discord_name text not null default '',
  can_substitute boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists availability (
  id text primary key,
  member_id text not null references members(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_minutes integer not null check (start_minutes between 0 and 1410 and start_minutes % 30 = 0),
  end_minutes integer not null check (end_minutes between 30 and 1440 and end_minutes % 30 = 0),
  check (end_minutes > start_minutes)
);

create table if not exists weekly_overrides (
  id text primary key,
  member_id text not null references members(id) on delete cascade,
  week_start date not null,
  status text not null default 'normal' check (status in ('normal', 'absent', 'late')),
  can_overtime boolean not null default false,
  late_after_minutes integer check (late_after_minutes is null or (late_after_minutes between 0 and 1410 and late_after_minutes % 30 = 0)),
  note text not null default '',
  unique (member_id, week_start)
);

create table if not exists raid_plans (
  id text primary key,
  team_id text not null references teams(id) on delete cascade,
  week_start date not null,
  weekday integer not null check (weekday between 0 and 6),
  start_minutes integer not null check (start_minutes between 0 and 1410 and start_minutes % 30 = 0),
  end_minutes integer not null check (end_minutes between 30 and 1440 and end_minutes % 30 = 0),
  created_at timestamptz not null default now(),
  check (end_minutes > start_minutes)
);

alter table teams enable row level security;
alter table members enable row level security;
alter table availability enable row level security;
alter table weekly_overrides enable row level security;
alter table raid_plans enable row level security;

create policy "public teams read" on teams for select using (true);
create policy "public teams insert" on teams for insert with check (true);
create policy "public members read" on members for select using (true);
create policy "public members insert" on members for insert with check (true);
create policy "public members update" on members for update using (true) with check (true);
create policy "public members delete" on members for delete using (true);
create policy "public availability read" on availability for select using (true);
create policy "public availability insert" on availability for insert with check (true);
create policy "public availability delete" on availability for delete using (true);
create policy "public weekly overrides read" on weekly_overrides for select using (true);
create policy "public weekly overrides insert" on weekly_overrides for insert with check (true);
create policy "public weekly overrides update" on weekly_overrides for update using (true) with check (true);
create policy "public weekly overrides delete" on weekly_overrides for delete using (true);
create policy "public raid plans read" on raid_plans for select using (true);
create policy "public raid plans insert" on raid_plans for insert with check (true);
create policy "public raid plans update" on raid_plans for update using (true) with check (true);
create policy "public raid plans delete" on raid_plans for delete using (true);
