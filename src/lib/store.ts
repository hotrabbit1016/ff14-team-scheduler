import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  generateId,
  getCurrentWeekStart,
  mealsToMinutes,
  normalizeMemberRole,
  normalizeAvailability,
  normalizeRoleRequirements,
  roleRequirementsForPartySize,
  slugifyTeamName,
  type Availability,
  type Member,
  type MemberRole,
  type OverrideStatus,
  type PartySize,
  type PreferredWindow,
  type RaidPlan,
  type RoleRequirements,
  type Team,
  type TeamMode,
  type WeeklyOverride,
} from "../domain/schedule";

type DatabaseShape = {
  teams: Team[];
  members: Member[];
  availability: Availability[];
  weeklyOverrides: WeeklyOverride[];
  raidPlans: RaidPlan[];
};

const STORAGE_KEY = "ff14-team-scheduler:v2";
const LEGACY_STORAGE_KEY = "ff14-team-scheduler:v1";

export type TeamBundle = {
  team: Team;
  members: Member[];
  availability: Availability[];
  weeklyOverrides: WeeklyOverride[];
  raidPlans: RaidPlan[];
};

export type CreateTeamInput = {
  name: string;
  contentName: string;
  teamMode: TeamMode;
  partySize: PartySize;
  roleRequirements: RoleRequirements;
  targetSessionsPerWeek: number;
  sessionLengthMeals: number;
  overtimeMeals: number;
  preferredWindows: PreferredWindow[];
};

export type MemberInput = {
  displayName: string;
  role: MemberRole;
  jobs: string;
  discordName: string;
  canSubstitute: boolean;
  notes: string;
};

export type WeeklyOverrideInput = {
  status: OverrideStatus;
  canOvertime: boolean;
  lateAfterMinutes: number | null;
  note: string;
};

export type TeamStore = {
  mode: "supabase" | "local";
  createTeam(input: CreateTeamInput): Promise<Team>;
  getTeamBySlug(slug: string): Promise<TeamBundle | null>;
  addMember(teamId: string, input: MemberInput): Promise<Member>;
  updateMember(memberId: string, input: MemberInput): Promise<void>;
  deleteMember(memberId: string): Promise<void>;
  replaceMemberAvailability(
    memberId: string,
    slots: Array<Omit<Availability, "id" | "memberId">>,
  ): Promise<void>;
  upsertWeeklyOverride(memberId: string, weekStart: string, input: WeeklyOverrideInput): Promise<void>;
  replaceRaidPlans(
    teamId: string,
    weekStart: string,
    plans: Array<Omit<RaidPlan, "id" | "teamId" | "weekStart" | "createdAt">>,
  ): Promise<void>;
};

function readLocal(): DatabaseShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return normalizeDatabase(JSON.parse(raw));

  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) return normalizeDatabase(JSON.parse(legacy));

  return { teams: [], members: [], availability: [], weeklyOverrides: [], raidPlans: [] };
}

function writeLocal(data: DatabaseShape) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function localStore(): TeamStore {
  return {
    mode: "local",
    async createTeam(input) {
      const data = readLocal();
      const team = buildTeam(input);
      data.teams.push(team);
      writeLocal(data);
      return team;
    },
    async getTeamBySlug(slug) {
      const data = readLocal();
      const team = data.teams.find((item) => item.publicSlug === slug);
      if (!team) return null;

      const members = data.members.filter((member) => member.teamId === team.id);
      const memberIds = new Set(members.map((member) => member.id));
      return {
        team,
        members,
        availability: data.availability.filter((slot) => memberIds.has(slot.memberId)),
        weeklyOverrides: data.weeklyOverrides.filter((override) => memberIds.has(override.memberId)),
        raidPlans: data.raidPlans.filter((plan) => plan.teamId === team.id),
      };
    },
    async addMember(teamId, input) {
      const data = readLocal();
      const member = buildMember(teamId, input);
      data.members.push(member);
      writeLocal(data);
      return member;
    },
    async updateMember(memberId, input) {
      const data = readLocal();
      data.members = data.members.map((member) => (member.id === memberId ? { ...member, ...input } : member));
      writeLocal(data);
    },
    async deleteMember(memberId) {
      const data = readLocal();
      data.members = data.members.filter((member) => member.id !== memberId);
      data.availability = data.availability.filter((slot) => slot.memberId !== memberId);
      data.weeklyOverrides = data.weeklyOverrides.filter((override) => override.memberId !== memberId);
      writeLocal(data);
    },
    async replaceMemberAvailability(memberId, slots) {
      const data = readLocal();
      const normalized = normalizeAvailability(slots.map((slot) => ({ ...slot, memberId })));
      data.availability = data.availability
        .filter((slot) => slot.memberId !== memberId)
        .concat(normalized.map((slot) => ({ ...slot, id: generateId("availability") })));
      writeLocal(data);
    },
    async upsertWeeklyOverride(memberId, weekStart, input) {
      const data = readLocal();
      const existing = data.weeklyOverrides.find(
        (override) => override.memberId === memberId && override.weekStart === weekStart,
      );
      if (existing) {
        Object.assign(existing, input);
      } else {
        data.weeklyOverrides.push({ id: generateId("override"), memberId, weekStart, ...input });
      }
      writeLocal(data);
    },
    async replaceRaidPlans(teamId, weekStart, plans) {
      const data = readLocal();
      data.raidPlans = data.raidPlans
        .filter((plan) => !(plan.teamId === teamId && plan.weekStart === weekStart))
        .concat(
          plans.map((plan) => ({
            ...plan,
            id: generateId("raidplan"),
            teamId,
            weekStart,
            createdAt: new Date().toISOString(),
          })),
        );
      writeLocal(data);
    },
  };
}

function supabaseStore(client: SupabaseClient): TeamStore {
  return {
    mode: "supabase",
    async createTeam(input) {
      const team = buildTeam(input);
      const { error } = await client.from("teams").insert({
        id: team.id,
        public_slug: team.publicSlug,
        name: team.name,
        content_name: team.contentName,
        team_mode: team.teamMode,
        party_size: team.partySize,
        role_requirements: team.roleRequirements,
        timezone: team.timezone,
        target_sessions_per_week: team.targetSessionsPerWeek,
        session_length_minutes: team.sessionLengthMinutes,
        session_length_meals: team.sessionLengthMeals,
        overtime_minutes: team.overtimeMinutes,
        overtime_meals: team.overtimeMeals,
        preferred_windows: team.preferredWindows,
        created_at: team.createdAt,
      });
      if (error) throw error;
      return team;
    },
    async getTeamBySlug(slug) {
      const { data: teamRow, error: teamError } = await client
        .from("teams")
        .select("*")
        .eq("public_slug", slug)
        .single();
      if (teamError || !teamRow) return null;

      const team = mapTeam(teamRow);
      const { data: memberRows, error: memberError } = await client
        .from("members")
        .select("*")
        .eq("team_id", team.id)
        .order("created_at", { ascending: true });
      if (memberError) throw memberError;

      const members = (memberRows ?? []).map(mapMember);
      const memberIds = members.map((member) => member.id);
      const { data: availabilityRows, error: availabilityError } = memberIds.length
        ? await client.from("availability").select("*").in("member_id", memberIds)
        : { data: [], error: null };
      if (availabilityError) throw availabilityError;

      const { data: overrideRows, error: overrideError } = memberIds.length
        ? await client.from("weekly_overrides").select("*").in("member_id", memberIds)
        : { data: [], error: null };
      if (overrideError) throw overrideError;

      const { data: raidPlanRows, error: raidPlanError } = await client
        .from("raid_plans")
        .select("*")
        .eq("team_id", team.id)
        .order("weekday", { ascending: true })
        .order("start_minutes", { ascending: true });
      if (raidPlanError) throw raidPlanError;

      return {
        team,
        members,
        availability: (availabilityRows ?? []).map(mapAvailability),
        weeklyOverrides: (overrideRows ?? []).map(mapWeeklyOverride),
        raidPlans: (raidPlanRows ?? []).map(mapRaidPlan),
      };
    },
    async addMember(teamId, input) {
      const member = buildMember(teamId, input);
      const { error } = await client.from("members").insert(memberToRow(member));
      if (error) throw error;
      return member;
    },
    async updateMember(memberId, input) {
      const { error } = await client
        .from("members")
        .update({
          display_name: input.displayName,
          role: input.role,
          jobs: input.jobs,
          discord_name: input.discordName,
          can_substitute: input.canSubstitute,
          notes: input.notes,
        })
        .eq("id", memberId);
      if (error) throw error;
    },
    async deleteMember(memberId) {
      const { error } = await client.from("members").delete().eq("id", memberId);
      if (error) throw error;
    },
    async replaceMemberAvailability(memberId, slots) {
      const normalized = normalizeAvailability(slots.map((slot) => ({ ...slot, memberId })));
      const { error: deleteError } = await client.from("availability").delete().eq("member_id", memberId);
      if (deleteError) throw deleteError;
      if (!normalized.length) return;

      const { error } = await client.from("availability").insert(
        normalized.map((slot) => ({
          id: generateId("availability"),
          member_id: memberId,
          weekday: slot.weekday,
          start_minutes: slot.startMinutes,
          end_minutes: slot.endMinutes,
        })),
      );
      if (error) throw error;
    },
    async upsertWeeklyOverride(memberId, weekStart, input) {
      const { data: existing } = await client
        .from("weekly_overrides")
        .select("id")
        .eq("member_id", memberId)
        .eq("week_start", weekStart)
        .maybeSingle();
      const { error } = await client.from("weekly_overrides").upsert({
        id: existing?.id ?? generateId("override"),
        member_id: memberId,
        week_start: weekStart,
        status: input.status,
        can_overtime: input.canOvertime,
        late_after_minutes: input.lateAfterMinutes,
        note: input.note,
      }, { onConflict: "member_id,week_start" });
      if (error) throw error;
    },
    async replaceRaidPlans(teamId, weekStart, plans) {
      const { error: deleteError } = await client
        .from("raid_plans")
        .delete()
        .eq("team_id", teamId)
        .eq("week_start", weekStart);
      if (deleteError) throw deleteError;
      if (!plans.length) return;

      const { error } = await client.from("raid_plans").insert(
        plans.map((plan) => ({
          id: generateId("raidplan"),
          team_id: teamId,
          week_start: weekStart,
          weekday: plan.weekday,
          start_minutes: plan.startMinutes,
          end_minutes: plan.endMinutes,
          created_at: new Date().toISOString(),
        })),
      );
      if (error) throw error;
    },
  };
}

function buildTeam(input: CreateTeamInput): Team {
  return {
    id: generateId("team"),
    publicSlug: slugifyTeamName(input.name),
    name: input.name.trim(),
    contentName: input.contentName.trim(),
    teamMode: input.teamMode,
    partySize: input.partySize,
    roleRequirements: input.roleRequirements,
    timezone: "Asia/Taipei",
    targetSessionsPerWeek: input.targetSessionsPerWeek,
    sessionLengthMeals: input.sessionLengthMeals,
    sessionLengthMinutes: mealsToMinutes(input.sessionLengthMeals),
    overtimeMeals: input.overtimeMeals,
    overtimeMinutes: mealsToMinutes(input.overtimeMeals),
    preferredWindows: input.preferredWindows,
    createdAt: new Date().toISOString(),
  };
}

function buildMember(teamId: string, input: MemberInput): Member {
  return {
    id: generateId("member"),
    teamId,
    displayName: input.displayName.trim(),
    role: normalizeMemberRole(input.role),
    jobs: input.jobs.trim(),
    discordName: input.discordName.trim(),
    canSubstitute: input.canSubstitute,
    notes: input.notes.trim(),
    createdAt: new Date().toISOString(),
  };
}

function normalizeDatabase(raw: Partial<DatabaseShape>): DatabaseShape {
  return {
    teams: (raw.teams ?? []).map(normalizeTeam),
    members: (raw.members ?? []).map(normalizeMember),
    availability: raw.availability ?? [],
    weeklyOverrides: raw.weeklyOverrides ?? [],
    raidPlans: (raw.raidPlans ?? []).map(normalizeRaidPlan),
  };
}

function normalizeTeam(team: Partial<Team> & { sessionLengthMinutes?: number }): Team {
  const partySize = normalizePartySize(team.partySize);
  const sessionLengthMeals = team.sessionLengthMeals ?? Math.max(1, (team.sessionLengthMinutes ?? 120) / 30);
  const overtimeMeals = team.overtimeMeals ?? Math.max(0, (team.overtimeMinutes ?? 0) / 30);
  return {
    id: String(team.id),
    publicSlug: String(team.publicSlug),
    name: String(team.name),
    contentName: team.contentName ?? "零式 / 絕本",
    teamMode: team.teamMode ?? "prog",
    partySize,
    roleRequirements: normalizeRoleRequirements(team.roleRequirements ?? roleRequirementsForPartySize(partySize)),
    timezone: "Asia/Taipei",
    targetSessionsPerWeek: team.targetSessionsPerWeek ?? 2,
    sessionLengthMeals,
    sessionLengthMinutes: mealsToMinutes(sessionLengthMeals),
    overtimeMeals,
    overtimeMinutes: mealsToMinutes(overtimeMeals),
    preferredWindows: team.preferredWindows ?? [
      { weekday: 0, startMinutes: 20 * 60, endMinutes: 24 * 60 },
      { weekday: 1, startMinutes: 20 * 60, endMinutes: 24 * 60 },
      { weekday: 2, startMinutes: 20 * 60, endMinutes: 24 * 60 },
      { weekday: 3, startMinutes: 20 * 60, endMinutes: 24 * 60 },
      { weekday: 4, startMinutes: 20 * 60, endMinutes: 24 * 60 },
    ],
    createdAt: String(team.createdAt ?? new Date().toISOString()),
  };
}

function normalizeMember(member: Partial<Member>): Member {
  return {
    id: String(member.id),
    teamId: String(member.teamId),
    displayName: String(member.displayName),
    role: normalizeMemberRole(member.role),
    jobs: member.jobs ?? "",
    discordName: member.discordName ?? "",
    canSubstitute: member.canSubstitute ?? false,
    notes: member.notes ?? "",
    createdAt: String(member.createdAt ?? new Date().toISOString()),
  };
}

function mapTeam(row: Record<string, unknown>): Team {
  return normalizeTeam({
    id: String(row.id),
    publicSlug: String(row.public_slug),
    name: String(row.name),
    contentName: String(row.content_name ?? ""),
    teamMode: (row.team_mode as TeamMode) ?? "prog",
    partySize: normalizePartySize(row.party_size),
    roleRequirements: normalizeRoleRequirements(row.role_requirements),
    targetSessionsPerWeek: Number(row.target_sessions_per_week ?? 2),
    sessionLengthMinutes: Number(row.session_length_minutes ?? 120),
    sessionLengthMeals: Number(row.session_length_meals ?? Number(row.session_length_minutes ?? 120) / 30),
    overtimeMinutes: Number(row.overtime_minutes ?? 0),
    overtimeMeals: Number(row.overtime_meals ?? Number(row.overtime_minutes ?? 0) / 30),
    preferredWindows: (row.preferred_windows as PreferredWindow[]) ?? [],
    createdAt: String(row.created_at),
  });
}

function mapMember(row: Record<string, unknown>): Member {
  return normalizeMember({
    id: String(row.id),
    teamId: String(row.team_id),
    displayName: String(row.display_name),
    role: normalizeMemberRole(row.role),
    jobs: String(row.jobs ?? ""),
    discordName: String(row.discord_name ?? ""),
    canSubstitute: Boolean(row.can_substitute),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at),
  });
}

function mapAvailability(row: Record<string, unknown>): Availability {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    weekday: Number(row.weekday),
    startMinutes: Number(row.start_minutes),
    endMinutes: Number(row.end_minutes),
  };
}

function mapWeeklyOverride(row: Record<string, unknown>): WeeklyOverride {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    weekStart: String(row.week_start ?? getCurrentWeekStart()),
    status: (row.status as OverrideStatus) ?? "normal",
    canOvertime: Boolean(row.can_overtime),
    lateAfterMinutes: row.late_after_minutes === null ? null : Number(row.late_after_minutes),
    note: String(row.note ?? ""),
  };
}

function normalizeRaidPlan(plan: Partial<RaidPlan>): RaidPlan {
  return {
    id: String(plan.id),
    teamId: String(plan.teamId),
    weekStart: String(plan.weekStart ?? getCurrentWeekStart()),
    weekday: Number(plan.weekday),
    startMinutes: Number(plan.startMinutes),
    endMinutes: Number(plan.endMinutes),
    createdAt: String(plan.createdAt ?? new Date().toISOString()),
  };
}

function mapRaidPlan(row: Record<string, unknown>): RaidPlan {
  return normalizeRaidPlan({
    id: String(row.id),
    teamId: String(row.team_id),
    weekStart: String(row.week_start ?? getCurrentWeekStart()),
    weekday: Number(row.weekday),
    startMinutes: Number(row.start_minutes),
    endMinutes: Number(row.end_minutes),
    createdAt: String(row.created_at),
  });
}

function memberToRow(member: Member) {
  return {
    id: member.id,
    team_id: member.teamId,
    display_name: member.displayName,
    role: member.role,
    jobs: member.jobs,
    discord_name: member.discordName,
    can_substitute: member.canSubstitute,
    notes: member.notes,
    created_at: member.createdAt,
  };
}

function normalizePartySize(value: unknown): PartySize {
  return 8;
}

export function createStore(): TeamStore {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) {
    return supabaseStore(createClient(url, key));
  }
  return localStore();
}
