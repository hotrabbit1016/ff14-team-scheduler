export const WEEKDAYS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"] as const;
export const SLOT_MINUTES = 30;
export const MEAL_MINUTES = 30;

export const PARTY_SIZES = [8] as const;
export const MEMBER_ROLES = ["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"] as const;

export type PartySize = (typeof PARTY_SIZES)[number];
export type TeamMode = "reclear" | "prog" | "ultimate" | "flexible";
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type OverrideStatus = "normal" | "absent" | "late";

export type RoleRequirements = Partial<Record<MemberRole, number>>;

export type PreferredWindow = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
};

export type Team = {
  id: string;
  publicSlug: string;
  name: string;
  contentName: string;
  teamMode: TeamMode;
  partySize: PartySize;
  roleRequirements: RoleRequirements;
  timezone: "Asia/Taipei";
  targetSessionsPerWeek: number;
  sessionLengthMinutes: number;
  sessionLengthMeals: number;
  overtimeMinutes: number;
  overtimeMeals: number;
  preferredWindows: PreferredWindow[];
  createdAt: string;
};

export type Member = {
  id: string;
  teamId: string;
  displayName: string;
  role: MemberRole;
  jobs: string;
  discordName: string;
  canSubstitute: boolean;
  notes: string;
  createdAt: string;
};

export type Availability = {
  id: string;
  memberId: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
};

export type WeeklyOverride = {
  id: string;
  memberId: string;
  weekStart: string;
  status: OverrideStatus;
  canOvertime: boolean;
  lateAfterMinutes: number | null;
  note: string;
};

export type RaidPlan = {
  id: string;
  teamId: string;
  weekStart: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  createdAt: string;
};

export type CandidateWindow = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  availableMembers: Member[];
  unavailableMembers: Member[];
  missingRoles: string[];
  attendanceScore: number;
  roleScore: number;
};

export type SessionStatus = "ready" | "needs_sub" | "weak";

export type WeeklyPlan = {
  selected: CandidateWindow[];
  targetSessions: number;
  missingSessionCount: number;
  candidateWindows: CandidateWindow[];
};

export type LeaderSummary = {
  confirmedCount: number;
  scheduledCount: number;
  targetSessions: number;
  missingSessionCount: number;
  headline: string;
  statusLabel: string;
  nextSteps: string[];
};

export function roleRequirementsForPartySize(_partySize: PartySize): RoleRequirements {
  return fixedRoleRequirements();
}

export function partySizeLabel(partySize: PartySize) {
  return `${partySize}人固定團`;
}

export function roleLabel(role: MemberRole) {
  return role;
}

export function roleRequirementsLabel(requirements: RoleRequirements) {
  const normalized = normalizeRoleRequirements(requirements);
  return MEMBER_ROLES.filter((role) => (normalized[role] ?? 0) > 0).join(" / ");
}

export function roleRequirementsTotal(requirements: RoleRequirements) {
  const normalized = normalizeRoleRequirements(requirements);
  return MEMBER_ROLES.reduce((sum, role) => sum + (normalized[role] ?? 0), 0);
}

export function minutesToMeals(minutes: number) {
  return minutes / MEAL_MINUTES;
}

export function mealsToMinutes(meals: number) {
  return meals * MEAL_MINUTES;
}

export function formatMealsFromMinutes(minutes: number) {
  const meals = minutesToMeals(minutes);
  return Number.isInteger(meals) ? `${meals}飯` : `${meals.toFixed(1)}飯`;
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

export function formatRange(startMinutes: number, endMinutes: number) {
  return `${formatMinutes(startMinutes)}-${formatMinutes(endMinutes)}`;
}

export function getCurrentWeekStart(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + mondayOffset);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

export function normalizeMemberRole(role: unknown): MemberRole {
  if (role === "MT" || role === "ST" || role === "H1" || role === "H2" || role === "D1" || role === "D2" || role === "D3" || role === "D4") {
    return role;
  }
  if (role === "TANK") return "MT";
  if (role === "HEALER") return "H1";
  if (role === "DPS") return "D1";
  if (role === "FLEX") return "D4";
  return "D1";
}

export function memberIsAvailable(
  member: Member,
  weekday: number,
  startMinutes: number,
  endMinutes: number,
  availability: Availability[],
  weeklyOverrides: WeeklyOverride[] = [],
) {
  const override = weeklyOverrides.find((item) => item.memberId === member.id);
  if (override?.status === "absent") return false;

  return availability.some(
    (slot) =>
      slot.memberId === member.id &&
      slot.weekday === weekday &&
      slot.startMinutes <= startMinutes &&
      slot.endMinutes >= endMinutes,
  );
}

export function normalizeAvailability(slots: Omit<Availability, "id">[]) {
  const sorted = [...slots]
    .filter((slot) => slot.endMinutes > slot.startMinutes)
    .sort((a, b) => a.memberId.localeCompare(b.memberId) || a.weekday - b.weekday || a.startMinutes - b.startMinutes);

  const merged: Omit<Availability, "id">[] = [];
  for (const slot of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.memberId === slot.memberId &&
      last.weekday === slot.weekday &&
      slot.startMinutes <= last.endMinutes
    ) {
      last.endMinutes = Math.max(last.endMinutes, slot.endMinutes);
    } else {
      merged.push({ ...slot });
    }
  }
  return merged;
}

export function computeCandidateWindows(
  members: Member[],
  availability: Availability[],
  team: Pick<Team, "roleRequirements">,
  weeklyOverrides: WeeklyOverride[] = [],
) {
  const result: CandidateWindow[] = [];

  for (let weekday = 0; weekday < WEEKDAYS.length; weekday += 1) {
    const boundaries = sortedBoundariesForWeekday(availability, weekday);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (end <= start) continue;

      const segment = buildCandidateWindow(members, availability, team.roleRequirements, weeklyOverrides, weekday, start, end);
      if (!segment.availableMembers.length) continue;

      const last = result[result.length - 1];
      if (
        last &&
        last.weekday === weekday &&
        last.endMinutes === segment.startMinutes &&
        sameMemberSet(last.availableMembers, segment.availableMembers)
      ) {
        last.endMinutes = segment.endMinutes;
      } else {
        result.push(segment);
      }
    }
  }

  return sortCandidates(result).slice(0, 24);
}

export function computeWeeklyPlan(
  members: Member[],
  availability: Availability[],
  team: Pick<Team, "roleRequirements">,
  weeklyOverrides: WeeklyOverride[] = [],
): WeeklyPlan {
  const candidateWindows = computeCandidateWindows(members, availability, team, weeklyOverrides);
  const selected: CandidateWindow[] = [];
  const usedWeekdays = new Set<number>();
  const requiredMemberCount = roleRequirementsTotal(team.roleRequirements);

  for (const candidate of candidateWindows) {
    if (usedWeekdays.has(candidate.weekday)) continue;
    if (getSessionStatus(candidate, requiredMemberCount) === "weak") continue;
    selected.push(candidate);
    usedWeekdays.add(candidate.weekday);
  }

  return {
    selected,
    targetSessions: selected.length,
    missingSessionCount: 0,
    candidateWindows,
  };
}

export function getSessionStatus(slot: CandidateWindow, totalMembers: number): SessionStatus {
  if (slot.missingRoles.length === 0 && slot.unavailableMembers.length === 0) return "ready";
  if (slot.availableMembers.length >= Math.max(1, totalMembers - 2)) return "needs_sub";
  return "weak";
}

export function sessionStatusLabel(status: SessionStatus) {
  if (status === "ready") return "滿員可練";
  if (status === "needs_sub") return "需補位";
  return "不建議";
}

export function computeLeaderSummary(
  weeklyPlan: WeeklyPlan,
  members: Member[],
  unfilledMembers: Member[],
  absentMembers: Member[],
  confirmedPlans: RaidPlan[] = [],
): LeaderSummary {
  const scheduledCount = weeklyPlan.selected.length;
  const requiredMemberCount = weeklyPlan.selected[0]
    ? weeklyPlan.selected[0].availableMembers.length + weeklyPlan.selected[0].missingRoles.length
    : members.length;
  const fullSlots = weeklyPlan.selected.filter((slot) => getSessionStatus(slot, requiredMemberCount) === "ready");
  const riskSlots = weeklyPlan.selected.filter((slot) => getSessionStatus(slot, requiredMemberCount) === "needs_sub");
  const nextSteps: string[] = [];

  if (weeklyPlan.selected.length) {
    nextSteps.push("可直接複製 DC 公告");
  } else {
    nextSteps.push("目前沒有可練場次，先請團員補填表");
  }

  if (unfilledMembers.length) nextSteps.push(`催填表：${unfilledMembers.map((member) => member.role).join("、")}`);
  if (absentMembers.length) nextSteps.push(`本週無法出團：${absentMembers.map((member) => member.role).join("、")}`);
  if (riskSlots.length) nextSteps.push("部分推薦場次需要補位或改時段");
  if (nextSteps.length === 1 && !unfilledMembers.length && !absentMembers.length) {
    nextSteps.push("人數與職能狀態穩定，可以直接發公告");
  }

  return {
    confirmedCount: confirmedPlans.length,
    scheduledCount,
    targetSessions: scheduledCount,
    missingSessionCount: 0,
    headline: scheduledCount
      ? `本週可練 ${scheduledCount} 場（滿員 ${fullSlots.length} / 需補 ${riskSlots.length}）`
      : "本週目前還沒有可練場次",
    statusLabel: scheduledCount ? "可排本週" : "等待填表",
    nextSteps,
  };
}

export function raidPlanToCandidateWindow(
  plan: RaidPlan,
  members: Member[],
  availability: Availability[],
  team: Pick<Team, "roleRequirements">,
  weeklyOverrides: WeeklyOverride[] = [],
): CandidateWindow {
  const availableMembers = members.filter((member) =>
    memberIsAvailable(member, plan.weekday, plan.startMinutes, plan.endMinutes, availability, weeklyOverrides),
  );
  const unavailableMembers = members.filter(
    (member) => !availableMembers.some((available) => available.id === member.id),
  );
  const missingRoles = computeMissingRoles(availableMembers, team.roleRequirements);
  return {
    weekday: plan.weekday,
    startMinutes: plan.startMinutes,
    endMinutes: plan.endMinutes,
    availableMembers,
    unavailableMembers,
    missingRoles,
    attendanceScore: availableMembers.length,
    roleScore: roleRequirementsTotal(team.roleRequirements) - missingRoleCount(missingRoles),
  };
}

export function computeMissingRoles(availableMembers: Member[], requirements: RoleRequirements) {
  const normalized = normalizeRoleRequirements(requirements);
  return MEMBER_ROLES.filter((role) => (normalized[role] ?? 0) > 0 && !availableMembers.some((member) => member.role === role));
}

function sortedBoundariesForWeekday(availability: Availability[], weekday: number) {
  const boundaries = new Set<number>();
  for (const slot of availability) {
    if (slot.weekday !== weekday) continue;
    boundaries.add(slot.startMinutes);
    boundaries.add(slot.endMinutes);
  }
  return [...boundaries].sort((a, b) => a - b);
}

function buildCandidateWindow(
  members: Member[],
  availability: Availability[],
  roleRequirements: RoleRequirements,
  weeklyOverrides: WeeklyOverride[],
  weekday: number,
  startMinutes: number,
  endMinutes: number,
): CandidateWindow {
  const availableMembers = members.filter((member) =>
    memberIsAvailable(member, weekday, startMinutes, endMinutes, availability, weeklyOverrides),
  );
  const unavailableMembers = members.filter(
    (member) => !availableMembers.some((available) => available.id === member.id),
  );
  const missingRoles = computeMissingRoles(availableMembers, roleRequirements);
  return {
    weekday,
    startMinutes,
    endMinutes,
    availableMembers,
    unavailableMembers,
    missingRoles,
    attendanceScore: availableMembers.length,
    roleScore: roleRequirementsTotal(roleRequirements) - missingRoleCount(missingRoles),
  };
}

export function formatMissingRoles(missing: RoleRequirements) {
  const normalized = normalizeRoleRequirements(missing);
  return MEMBER_ROLES.filter((role) => (normalized[role] ?? 0) > 0);
}

export function createDiscordAnnouncement(
  team: Team,
  weeklyPlan: WeeklyPlan,
  members: Member[],
  teamUrl: string,
) {
  const announcementSlots = weeklyPlan.selected;
  const requiredMemberCount = roleRequirementsTotal(team.roleRequirements);
  const lines = [
    `【${team.name}｜${partySizeLabel(team.partySize)}｜${team.contentName || "未設定團本"}】`,
    `位置：${roleRequirementsLabel(team.roleRequirements)}`,
    "",
    "本週可練場次：",
    ...(announcementSlots.length
      ? announcementSlots.map(
          (slot, index) =>
            `${index + 1}. ${WEEKDAYS[slot.weekday]} ${formatRange(slot.startMinutes, slot.endMinutes)}｜${formatMealsFromMinutes(slot.endMinutes - slot.startMinutes)}｜${slot.availableMembers.length}/${requiredMemberCount} 可出｜${sessionStatusLabel(getSessionStatus(slot, requiredMemberCount))}｜缺位置：${slot.missingRoles.join("、") || "無"}｜不可出：${slot.unavailableMembers.map((member) => member.role).join("、") || "無"}`,
        )
      : ["目前還沒有交集時段，請團員補填可出時間。"]),
    "",
    `隊伍頁：${teamUrl}`,
  ];

  return lines.join("\n");
}

function missingRoleCount(missingRoles: string[]) {
  return missingRoles.length;
}

function sortCandidates(candidates: CandidateWindow[]) {
  return [...candidates].sort(
    (a, b) =>
      b.attendanceScore - a.attendanceScore ||
      b.roleScore - a.roleScore ||
      b.endMinutes - b.startMinutes - (a.endMinutes - a.startMinutes) ||
      a.weekday - b.weekday ||
      a.startMinutes - b.startMinutes,
  );
}

function sameMemberSet(a: Member[], b: Member[]) {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((member) => member.id));
  return b.every((member) => ids.has(member.id));
}

export function generateId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

export function slugifyTeamName(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `${base || "team"}-${Math.random().toString(36).slice(2, 8)}`;
}

export function fixedRoleRequirements(): RoleRequirements {
  return {
    MT: 1,
    ST: 1,
    H1: 1,
    H2: 1,
    D1: 1,
    D2: 1,
    D3: 1,
    D4: 1,
  };
}

export function normalizeRoleRequirements(requirements: unknown): RoleRequirements {
  const value = requirements && typeof requirements === "object" ? requirements as Record<string, unknown> : {};
  const hasFixedRoles = MEMBER_ROLES.some((role) => Number(value[role] ?? 0) > 0);
  if (hasFixedRoles) {
    return MEMBER_ROLES.reduce<RoleRequirements>((result, role) => {
      result[role] = Number(value[role] ?? 0);
      return result;
    }, {});
  }
  return fixedRoleRequirements();
}
