import { describe, expect, it } from "vitest";
import {
  computeLeaderSummary,
  computeCandidateWindows,
  computeMissingRoles,
  computeWeeklyPlan,
  createDiscordAnnouncement,
  formatMealsFromMinutes,
  getSessionStatus,
  normalizeAvailability,
  normalizeMemberRole,
  roleRequirementsLabel,
  roleRequirementsForPartySize,
  type Availability,
  type Member,
  type Team,
  type WeeklyOverride,
} from "./schedule";

const team: Team = {
  id: "t",
  publicSlug: "team",
  name: "測試固定團",
  contentName: "M5S-M8S",
  teamMode: "prog",
  partySize: 8,
  roleRequirements: roleRequirementsForPartySize(8),
  timezone: "Asia/Taipei",
  targetSessionsPerWeek: 3,
  sessionLengthMinutes: 120,
  sessionLengthMeals: 4,
  overtimeMinutes: 30,
  overtimeMeals: 1,
  preferredWindows: [],
  createdAt: "",
};

const members: Member[] = [
  member("a", "Alice", "MT"),
  member("b", "Bob", "H1"),
  member("c", "Cecil", "D1"),
  member("d", "Dora", "D4"),
];

const fullMembers: Member[] = [
  member("mt", "MT", "MT"),
  member("st", "ST", "ST"),
  member("h1", "H1", "H1"),
  member("h2", "H2", "H2"),
  member("d1", "D1", "D1"),
  member("d2", "D2", "D2"),
  member("d3", "D3", "D3"),
  member("d4", "D4", "D4"),
];

describe("computeWeeklyPlan", () => {
  it("selects one practice session per available weekday", () => {
    const availability: Availability[] = [
      ...slotsForMembers(fullMembers, 0, 20, 23),
      ...slotsForMembers(fullMembers, 1, 20, 22),
      ...slotsForMembers(fullMembers, 2, 20, 22),
      ...slotsForMembers(fullMembers, 3, 20, 22),
      ...slotsForMembers(fullMembers, 4, 20, 22),
    ];

    const plan = computeWeeklyPlan(fullMembers, availability, team);

    expect(plan.selected).toHaveLength(5);
    expect(plan.missingSessionCount).toBe(0);
    expect(plan.selected.map((candidate) => candidate.weekday)).toEqual([0, 1, 2, 3, 4]);
    expect(plan.selected[0].endMinutes).toBe(23 * 60);
  });

  it("counts a 7/8 day as a practice session that needs a substitute", () => {
    const sevenMembers = fullMembers.filter((member) => member.role !== "ST");
    const plan = computeWeeklyPlan(sevenMembers, slotsForMembers(sevenMembers, 0, 20, 22), team);

    expect(plan.selected).toHaveLength(1);
    expect(plan.missingSessionCount).toBe(0);
    expect(plan.selected[0].missingRoles).toEqual(["ST"]);
    expect(getSessionStatus(plan.selected[0], 8)).toBe("needs_sub");
  });

  it("uses the overlap of submitted participation windows instead of a fixed session length", () => {
    const plan = computeWeeklyPlan(fullMembers, [
      slot("mt", 0, 20, 24),
      slot("st", 0, 20, 24),
      slot("h1", 0, 20, 22),
      slot("h2", 0, 20, 24),
      slot("d1", 0, 20, 24),
      slot("d2", 0, 20, 24),
      slot("d3", 0, 20, 24),
      slot("d4", 0, 20, 24),
    ], team);

    expect(plan.selected[0].startMinutes).toBe(20 * 60);
    expect(plan.selected[0].endMinutes).toBe(22 * 60);
    expect(plan.selected[0].availableMembers.map((item) => item.role)).toEqual(["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"]);
  });

  it("excludes absent members from availability", () => {
    const overrides: WeeklyOverride[] = [
      {
        id: "o",
        memberId: "st",
        weekStart: "2026-06-22",
        status: "absent",
        canOvertime: false,
        lateAfterMinutes: null,
        note: "",
      },
    ];

    const [best] = computeWeeklyPlan(fullMembers, slotsForMembers(fullMembers, 0, 20, 22), team, overrides).selected;

    expect(best.availableMembers.map((item) => item.role)).toEqual(["MT", "H1", "H2", "D1", "D2", "D3", "D4"]);
    expect(best.unavailableMembers.map((item) => item.role)).toEqual(["ST"]);
    expect(best.missingRoles).toEqual(["ST"]);
  });
});

describe("role coverage, meals, and migration", () => {
  it("uses the fixed 8-person static positions", () => {
    expect(roleRequirementsLabel(roleRequirementsForPartySize(8))).toBe("MT / ST / H1 / H2 / D1 / D2 / D3 / D4");
  });

  it("reports missing fixed positions", () => {
    expect(computeMissingRoles([member("x", "Main Tank", "MT"), member("y", "Melee", "D1")], roleRequirementsForPartySize(8))).toEqual([
      "ST",
      "H1",
      "H2",
      "D2",
      "D3",
      "D4",
    ]);
  });

  it("keeps fixed-position roles and migrates old broad roles to defaults", () => {
    expect(normalizeMemberRole("MT")).toBe("MT");
    expect(normalizeMemberRole("ST")).toBe("ST");
    expect(normalizeMemberRole("H1")).toBe("H1");
    expect(normalizeMemberRole("D1")).toBe("D1");
    expect(normalizeMemberRole("TANK")).toBe("MT");
    expect(normalizeMemberRole("HEALER")).toBe("H1");
    expect(normalizeMemberRole("DPS")).toBe("D1");
    expect(normalizeMemberRole("FLEX")).toBe("D4");
  });

  it("formats 120 minutes as 4飯", () => {
    expect(formatMealsFromMinutes(120)).toBe("4飯");
  });

  it("creates Discord announcement text with schedule, missing members, meals, and link", () => {
    const sevenMembers = fullMembers.filter((member) => member.role !== "ST");
    const plan = computeWeeklyPlan(sevenMembers, slotsForMembers(sevenMembers, 0, 20, 22), team);
    const text = createDiscordAnnouncement(team, plan, members, "https://example.com/join");

    expect(text).toContain("測試固定團");
    expect(text).toContain("8人固定團");
    expect(text).toContain("位置：MT / ST / H1 / H2 / D1 / D2 / D3 / D4");
    expect(text).toContain("週一 20:00-22:00");
    expect(text).toContain("需補位");
    expect(text).toContain("缺位置：ST");
    expect(text).toContain("https://example.com/join");
  });

  it("uses recommended raid slots in Discord announcement without requiring confirmed plans", () => {
    const plan = computeWeeklyPlan(fullMembers, [
      ...slotsForMembers(fullMembers, 0, 20, 22),
      ...slotsForMembers(fullMembers, 1, 21, 23),
    ], team);
    const text = createDiscordAnnouncement(team, plan, members, "https://example.com/join");

    expect(text).toContain("本週可練場次");
    expect(text).toContain("週一 20:00-22:00");
  });
});

describe("leader decision helpers", () => {
  it("classifies sessions by practical raid readiness", () => {
    const readyPlan = computeWeeklyPlan(fullMembers, [
      slot("mt", 0, 20, 22),
      slot("st", 0, 20, 22),
      slot("h1", 0, 20, 22),
      slot("h2", 0, 20, 22),
      slot("d1", 0, 20, 22),
      slot("d2", 0, 20, 22),
      slot("d3", 0, 20, 22),
      slot("d4", 0, 20, 22),
    ], team);
    const [weakCandidate] = computeCandidateWindows(members, [slot("a", 0, 20, 22)], team);

    expect(getSessionStatus(readyPlan.selected[0], fullMembers.length)).toBe("ready");
    expect(getSessionStatus(weakCandidate, 8)).toBe("weak");
  });

  it("summarizes target progress, unfilled members, and absences", () => {
    const sevenMembers = fullMembers.filter((member) => member.role !== "ST");
    const plan = computeWeeklyPlan(sevenMembers, slotsForMembers(sevenMembers, 0, 20, 22), team);
    const summary = computeLeaderSummary(plan, members, [members[2]], [members[3]], [
      {
        id: "rp",
        teamId: "t",
        weekStart: "2026-06-22",
        weekday: 0,
        startMinutes: 20 * 60,
        endMinutes: 22 * 60,
        createdAt: "",
      },
    ]);

    expect(summary.headline).toContain("本週可練 1 場");
    expect(summary.statusLabel).toBe("可排本週");
    expect(summary.nextSteps.join(" ")).toContain("D1");
    expect(summary.nextSteps.join(" ")).toContain("D4");
    expect(summary.nextSteps.join(" ")).not.toContain("Cecil");
  });
});

describe("normalizeAvailability", () => {
  it("merges overlapping and touching slots for the same member and weekday", () => {
    expect(
      normalizeAvailability([
        { memberId: "a", weekday: 0, startMinutes: 20 * 60, endMinutes: 21 * 60 },
        { memberId: "a", weekday: 0, startMinutes: 21 * 60, endMinutes: 22 * 60 },
        { memberId: "a", weekday: 1, startMinutes: 21 * 60, endMinutes: 22 * 60 },
      ]),
    ).toEqual([
      { memberId: "a", weekday: 0, startMinutes: 20 * 60, endMinutes: 22 * 60 },
      { memberId: "a", weekday: 1, startMinutes: 21 * 60, endMinutes: 22 * 60 },
    ]);
  });
});

function member(id: string, displayName: string, role: Member["role"]): Member {
  return {
    id,
    teamId: "t",
    displayName,
    role,
    jobs: "",
    discordName: "",
    canSubstitute: false,
    notes: "",
    createdAt: "",
  };
}

function slot(memberId: string, weekday: number, startHour: number, endHour: number): Availability {
  return {
    id: `${memberId}-${weekday}-${startHour}`,
    memberId,
    weekday,
    startMinutes: startHour * 60,
    endMinutes: endHour * 60,
  };
}

function slotsForMembers(members: Member[], weekday: number, startHour: number, endHour: number) {
  return members.map((member) => slot(member.id, weekday, startHour, endHour));
}
