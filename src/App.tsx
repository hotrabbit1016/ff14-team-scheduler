import { CalendarCheck, ClipboardCopy, Clock3, Copy, Plus, ShieldAlert, Trash2, UsersRound, Utensils } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  MEMBER_ROLES,
  SLOT_MINUTES,
  WEEKDAYS,
  computeLeaderSummary,
  computeWeeklyPlan,
  createDiscordAnnouncement,
  formatMealsFromMinutes,
  formatMinutes,
  formatRange,
  getCurrentWeekStart,
  getSessionStatus,
  partySizeLabel,
  normalizeAvailability,
  roleLabel,
  roleRequirementsForPartySize,
  roleRequirementsLabel,
  sessionStatusLabel,
  type Availability,
  type CandidateWindow,
  type Member,
  type MemberRole,
  type WeeklyOverride,
} from "./domain/schedule";
import { createStore, type MemberInput, type TeamBundle, type WeeklyOverrideInput } from "./lib/store";

const store = createStore();
const WEEK_START = getCurrentWeekStart();

const XIVAPI_ICON_URL = "https://cafemaker.wakingsands.com/i/026000/026039.png";
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

type Route =
  | { name: "home" }
  | { name: "team"; slug: string }
  | { name: "join"; slug: string; role?: MemberRole }
  | { name: "member"; slug: string; memberId: string };

function parseRoute(): Route {
  const parts = stripBasePath(window.location.pathname)
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts[0] === "team" && parts[1] && parts[2] === "join") {
    return { name: "join", slug: parts[1], role: parseRoleParam(new URLSearchParams(window.location.search).get("role")) };
  }
  if (parts[0] === "team" && parts[1] && parts[2] === "member" && parts[3]) {
    return { name: "member", slug: parts[1], memberId: parts[3] };
  }
  if (parts[0] === "team" && parts[1]) {
    return { name: "team", slug: parts[1] };
  }
  return { name: "home" };
}

function parseRoleParam(value: string | null): MemberRole | undefined {
  return MEMBER_ROLES.find((role) => role === value);
}

function navigate(path: string) {
  window.history.pushState({}, "", withBasePath(path));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function stripBasePath(pathname: string) {
  if (!BASE_PATH || BASE_PATH === "/") return pathname;
  return pathname === BASE_PATH ? "/" : pathname.replace(new RegExp(`^${escapeRegExp(BASE_PATH)}(?=/|$)`), "");
}

function withBasePath(path: string) {
  if (!BASE_PATH || BASE_PATH === "/") return path;
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

function absoluteAppUrl(path: string) {
  return `${window.location.origin}${withBasePath(path)}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function App() {
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <main>
      <header className="app-header">
        <button className="brand" onClick={() => navigate("/")}>
          <CalendarCheck size={22} />
          <span>FF14 固定團排班</span>
        </button>
        <span className="storage-pill">{store.mode === "supabase" ? "Supabase" : "本機模式"}</span>
      </header>

      {route.name === "home" && <HomePage />}
      {route.name === "team" && <TeamPage slug={route.slug} />}
      {route.name === "join" && <JoinPage initialRole={route.role} slug={route.slug} />}
      {route.name === "member" && <MemberPage slug={route.slug} memberId={route.memberId} />}
    </main>
  );
}

function HomePage() {
  const [name, setName] = useState("零式固定團");
  const [contentName, setContentName] = useState("M5S-M8S 拓荒");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("請輸入隊伍名稱。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const team = await store.createTeam({
        name,
        contentName,
        teamMode: "prog",
        partySize: 8,
        roleRequirements: roleRequirementsForPartySize(8),
        targetSessionsPerWeek: 3,
        sessionLengthMeals: 4,
        overtimeMeals: 0,
        preferredWindows: [],
      });
      navigate(`/team/${team.publicSlug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立隊伍失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="home-shell">
      <div className="home-copy">
        <div className="xivapi-mark">
          <img alt="" src={XIVAPI_ICON_URL} />
          <span>XIVAPI 遊戲素材</span>
        </div>
        <p className="eyebrow">Asia/Taipei · 1飯=30分鐘 · DC公告</p>
        <h1>固定團喬時間，不用再翻聊天紀錄。</h1>
        <p>
          建立隊伍頁，團員從 MT/ST/H1/H2/D1-D4 點自己的位置填可出時段，系統直接整理本週可練幾場和缺哪個位置。
        </p>
      </div>

      <form className="panel create-panel" onSubmit={onSubmit}>
        <div className="form-grid">
          <label>
            隊伍名稱
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
          </label>
          <label>
            團本內容
            <input value={contentName} onChange={(event) => setContentName(event.target.value)} maxLength={48} />
          </label>
        </div>
        <p className="hint good">定位：零式 / 絕本 8 人固定團，職能位置固定為 {roleRequirementsLabel(roleRequirementsForPartySize(8))}。</p>

        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={saving}>
          <Plus size={18} />
          {saving ? "建立中" : "建立隊伍頁"}
        </button>
      </form>
    </section>
  );
}

function TeamPage({ slug }: { slug: string }) {
  const { bundle, loading, error, reload } = useTeamBundle(slug);
  const [copied, setCopied] = useState("");

  if (loading) return <StatusPanel text="讀取隊伍中" />;
  if (error) return <StatusPanel text={error} />;
  if (!bundle) return <StatusPanel text="找不到這個隊伍。" />;

  const { team, members, availability, weeklyOverrides } = bundle;
  const thisWeekOverrides = weeklyOverrides.filter((override) => override.weekStart === WEEK_START);
  const weeklyPlan = computeWeeklyPlan(members, availability, team, thisWeekOverrides);
  const teamUrl = absoluteAppUrl(`/team/${team.publicSlug}`);
  const announcement = createDiscordAnnouncement(team, weeklyPlan, members, teamUrl);
  const respondedMembers = members.filter(
    (member) =>
      availability.some((slot) => slot.memberId === member.id) ||
      thisWeekOverrides.some((override) => override.memberId === member.id && override.status === "absent"),
  );
  const unfilledMembers = members.filter((member) => !respondedMembers.some((responded) => responded.id === member.id));
  const absentMembers = members.filter((member) =>
    thisWeekOverrides.some((override) => override.memberId === member.id && override.status === "absent"),
  );
  const leaderSummary = computeLeaderSummary(weeklyPlan, members, unfilledMembers, absentMembers);

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  async function deleteMember(member: Member) {
    const confirmed = window.confirm(`刪除 ${member.displayName} 與他的排班資料？`);
    if (!confirmed) return;
    await store.deleteMember(member.id);
    await reload();
  }

  return (
    <section className="workspace">
      <div className="page-title">
        <p className="eyebrow">
          {partySizeLabel(team.partySize)} · {team.contentName || "未設定團本"} · 台灣時間
        </p>
        <h1>{team.name}</h1>
        <p className="page-subtitle">
          需求 {roleRequirementsLabel(team.roleRequirements)} · 團員填可參與時段
        </p>
        <div className="action-row">
          <button className="secondary-button" onClick={() => copy(teamUrl, "team")}>
            <Copy size={18} />
            {copied === "team" ? "已複製" : "複製隊伍連結"}
          </button>
        </div>
      </div>

      <SimpleTeamPage
        absentMembers={absentMembers}
        availability={availability}
        copied={copied}
        leaderSummary={leaderSummary}
        members={members}
        onCopyAnnouncement={() => copy(announcement, "announcement")}
        onCopyTeamUrl={() => copy(teamUrl, "team")}
        onDelete={deleteMember}
        overrides={thisWeekOverrides}
        teamSlug={team.publicSlug}
        teamPartySize={team.partySize}
        respondedCount={respondedMembers.length}
        unfilledMembers={unfilledMembers}
        weeklyPlan={weeklyPlan}
      />
    </section>
  );
}

function SimpleTeamPage({
  weeklyPlan,
  leaderSummary,
  members,
  availability,
  overrides,
  teamSlug,
  teamPartySize,
  respondedCount,
  copied,
  unfilledMembers,
  absentMembers,
  onDelete,
  onCopyTeamUrl,
  onCopyAnnouncement,
}: {
  weeklyPlan: ReturnType<typeof computeWeeklyPlan>;
  leaderSummary: ReturnType<typeof computeLeaderSummary>;
  members: Member[];
  availability: Availability[];
  overrides: WeeklyOverride[];
  teamSlug: string;
  teamPartySize: number;
  respondedCount: number;
  copied: string;
  unfilledMembers: Member[];
  absentMembers: Member[];
  onDelete: (member: Member) => void;
  onCopyTeamUrl: () => void;
  onCopyAnnouncement: () => void;
}) {
  const visibleSlots = weeklyPlan.selected;
  const nearPracticeSlots = getNearPracticeSlots(weeklyPlan.candidateWindows, visibleSlots, teamPartySize);

  return (
    <div className="dashboard-grid">
      <section className="panel span-2">
        <div className="section-heading split-heading">
          <div>
            <CalendarCheck size={20} />
            <h2>本週可練場次</h2>
          </div>
          <button className="secondary-button" onClick={onCopyAnnouncement}>
            <ClipboardCopy size={18} />
            {copied === "announcement" ? "已複製" : "複製 DC 公告"}
          </button>
        </div>
        <p className="decision-headline">{leaderSummary.headline}</p>
        {visibleSlots.length === 0 ? (
          <EmptyState text="目前還沒有可練場次。請未填表團員補填，或直接調整可出時段。" />
        ) : (
          <div className="session-list">
            {visibleSlots.map((slot, index) => (
              <CandidateCard
                index={index}
                key={`${slot.weekday}-${slot.startMinutes}`}
                members={members}
                requiredMemberCount={teamPartySize}
                slot={slot}
              />
            ))}
          </div>
        )}
        {nearPracticeSlots.length > 0 && (
          <p className="hint warn">
            還有 {nearPracticeSlots.length} 個接近可練時段，主要缺 {summarizeMissingRoles(nearPracticeSlots)}；可先催未填位置或問能不能改時段。
          </p>
        )}
      </section>

      <PositionProgressPanel
        absentMembers={absentMembers}
        availability={availability}
        members={members}
        respondedCount={respondedCount}
        teamPartySize={teamPartySize}
        unfilledMembers={unfilledMembers}
        copied={copied}
        onCopyTeamUrl={onCopyTeamUrl}
      />

      <MembersTab
        availability={availability}
        members={members}
        overrides={overrides}
        teamSlug={teamSlug}
        onDelete={onDelete}
      />
    </div>
  );
}

function PositionProgressPanel({
  members,
  availability,
  unfilledMembers,
  absentMembers,
  respondedCount,
  teamPartySize,
  copied,
  onCopyTeamUrl,
}: {
  members: Member[];
  availability: Availability[];
  unfilledMembers: Member[];
  absentMembers: Member[];
  respondedCount: number;
  teamPartySize: number;
  copied: string;
  onCopyTeamUrl: () => void;
}) {
  const rolesWithSlots = rolesForMembers(members.filter((member) => availability.some((slot) => slot.memberId === member.id)));
  const absentRoles = rolesForMembers(absentMembers);
  const unfilledRoles = missingOrUnfilledRoles(members, unfilledMembers);

  return (
    <section className="panel">
      <div className="section-heading split-heading">
        <div>
          <ShieldAlert size={20} />
          <h2>回覆進度</h2>
        </div>
        <button className="secondary-button" onClick={onCopyTeamUrl}>
          <Copy size={18} />
          {copied === "team" ? "已複製" : "複製隊伍連結"}
        </button>
      </div>
      <p className="decision-headline">{respondedCount}/{teamPartySize} 人已回覆</p>
      <div className="response-lines">
        <p><strong>已填：</strong>{rolesWithSlots.length ? rolesWithSlots.join("、") : "無"}</p>
        <p><strong>未填：</strong>{unfilledRoles.length ? unfilledRoles.join("、") : "無"}</p>
        <p><strong>本週無法：</strong>{absentRoles.length ? absentRoles.join("、") : "無"}</p>
      </div>
    </section>
  );
}

function MembersTab({
  members,
  availability,
  overrides,
  teamSlug,
  onDelete,
}: {
  members: Member[];
  availability: Availability[];
  overrides: WeeklyOverride[];
  teamSlug: string;
  onDelete: (member: Member) => void;
}) {
  return (
    <section className="panel span-2">
      <div className="section-heading split-heading">
        <div>
          <UsersRound size={20} />
          <h2>團員名單</h2>
        </div>
      </div>
      <div className="position-grid">
        {MEMBER_ROLES.map((role) => {
          const roleMembers = members.filter((member) => member.role === role);
          return (
            <article className={`position-card ${roleToneClass(role)}`} key={role}>
              <div className="position-card-header">
                <strong>{roleLabel(role)}</strong>
                <span className={`role-badge ${roleToneClass(role)}`}>{roleGroupLabel(role)}</span>
              </div>
              {roleMembers.length === 0 ? (
                <div className="position-empty">
                  <span className="muted">未填</span>
                  <button className="secondary-button fill-position-button" onClick={() => navigate(`/team/${teamSlug}/join?role=${role}`)}>
                    <Plus size={16} />
                    填 {roleLabel(role)}
                  </button>
                </div>
              ) : roleMembers.map((member) => {
                const count = availability.filter((slot) => slot.memberId === member.id).length;
                const override = overrides.find((item) => item.memberId === member.id);
                return (
                  <div aria-label={`成員 ${member.displayName}`} className="position-member" key={member.id}>
                    <div className="member-main">
                      <strong>{member.displayName}</strong>
                    </div>
                    <span className={`status-badge ${override?.status === "absent" ? "danger" : count ? "good" : "warn"}`}>
                      {override?.status === "absent" ? "本週無法" : count ? "已填" : "未填"}
                    </span>
                    <div className="icon-actions">
                      <button
                        className="icon-button"
                        title="編輯"
                        onClick={() => navigate(`/team/${teamSlug}/member/${member.id}`)}
                      >
                        <CalendarCheck size={18} />
                      </button>
                      <button className="icon-button danger" title="刪除" onClick={() => onDelete(member)}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function JoinPage({ initialRole, slug }: { initialRole?: MemberRole; slug: string }) {
  const { bundle, loading, error } = useTeamBundle(slug);
  const [profile, setProfile] = useState<MemberInput>(() => emptyMemberInput(initialRole));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initialRole) return;
    setProfile((current) => ({ ...current, role: initialRole }));
  }, [initialRole]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!bundle || !profile.displayName.trim()) return;
    setSaving(true);
    const member = await store.addMember(bundle.team.id, profile);
    navigate(`/team/${bundle.team.publicSlug}/member/${member.id}`);
  }

  if (loading) return <StatusPanel text="讀取隊伍中" />;
  if (error) return <StatusPanel text={error} />;
  if (!bundle) return <StatusPanel text="找不到這個隊伍。" />;

  return (
    <section className="narrow-page">
      <form className="panel member-form" onSubmit={onSubmit}>
        <p className="eyebrow">{bundle.team.name}</p>
        <h1>{initialRole ? `填 ${roleLabel(initialRole)} 位置` : "加入隊伍"}</h1>
        <CompactMemberProfileFields profile={profile} setProfile={setProfile} />
        <button className="primary-button" type="submit" disabled={saving || !profile.displayName.trim()}>
          <Plus size={18} />
          {saving ? "加入中" : "加入並填寫時間"}
        </button>
      </form>
    </section>
  );
}

function MemberPage({ slug, memberId }: { slug: string; memberId: string }) {
  const { bundle, loading, error } = useTeamBundle(slug);
  const member = bundle?.members.find((item) => item.id === memberId);
  const [profile, setProfile] = useState<MemberInput>(emptyMemberInput());
  const [draftSlots, setDraftSlots] = useState<Array<Omit<Availability, "id" | "memberId">>>([]);
  const [override, setOverride] = useState<WeeklyOverrideInput>({
    status: "normal",
    canOvertime: false,
    lateAfterMinutes: null,
    note: "",
  });
  const [weekday, setWeekday] = useState(0);
  const [startMinutes, setStartMinutes] = useState(20 * 60);
  const [endMinutes, setEndMinutes] = useState(22 * 60);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!bundle || !member) return;
    setProfile(memberToInput(member));
    setDraftSlots(
      bundle.availability
        .filter((slot) => slot.memberId === member.id)
        .map(({ weekday, startMinutes, endMinutes }) => ({ weekday, startMinutes, endMinutes })),
    );
    const existingOverride = bundle.weeklyOverrides.find(
      (item) => item.memberId === member.id && item.weekStart === WEEK_START,
    );
    setOverride(
      existingOverride
        ? {
            status: existingOverride.status === "absent" ? "absent" : "normal",
            canOvertime: false,
            lateAfterMinutes: null,
            note: "",
          }
        : { status: "normal", canOvertime: false, lateAfterMinutes: null, note: "" },
    );
  }, [bundle, member]);

  async function save() {
    if (!member || !bundle || !profile.displayName.trim()) return;
    await store.updateMember(member.id, { ...profile, jobs: "", discordName: "" });
    await store.replaceMemberAvailability(member.id, draftSlots);
    await store.upsertWeeklyOverride(member.id, WEEK_START, override);
    navigate(`/team/${bundle.team.publicSlug}`);
  }

  function addSlot() {
    if (endMinutes <= startMinutes) {
      setMessage("結束時間必須晚於開始時間。");
      return;
    }
    setDraftSlots((current) =>
      normalizeAvailability(
        [...current, { weekday, startMinutes, endMinutes }].map((slot) => ({ ...slot, memberId: "draft" })),
      ).map(({ weekday, startMinutes, endMinutes }) => ({ weekday, startMinutes, endMinutes })),
    );
  }

  function applyQuickSlots(slots: Array<Omit<Availability, "id" | "memberId">>) {
    setDraftSlots((current) =>
      normalizeAvailability(
        [...current, ...slots].map((slot) => ({ ...slot, memberId: "draft" })),
      ).map(({ weekday, startMinutes, endMinutes }) => ({ weekday, startMinutes, endMinutes })),
    );
  }

  if (loading) return <StatusPanel text="讀取成員資料中" />;
  if (error) return <StatusPanel text={error} />;
  if (!bundle || !member) return <StatusPanel text="找不到這位成員。" />;

  return (
    <section className="workspace">
      <div className="page-title">
        <p className="eyebrow">{bundle.team.name}</p>
        <h1>{member.displayName} 的本週填表</h1>
        <div className="action-row">
          <button className="secondary-button" onClick={() => navigate(`/team/${bundle.team.publicSlug}`)}>
            回隊伍頁
          </button>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel span-2">
          <h2>本週無法出團</h2>
          <label className="checkbox-row">
            <input
              checked={override.status === "absent"}
              onChange={(event) =>
                setOverride({
                  status: event.target.checked ? "absent" : "normal",
                  canOvertime: false,
                  lateAfterMinutes: null,
                  note: "",
                })
              }
              type="checkbox"
            />
            本週無法出團
          </label>
          <p className="muted">晚到或只能打部分時間，直接在下面填可出時段即可。</p>
          {message && <p className="form-message">{message}</p>}
        </section>

        <section className="panel span-2">
          <div className="section-heading split-heading">
            <div>
              <Clock3 size={20} />
              <h2>可出團時段</h2>
            </div>
          </div>
          <div className="quick-slot-row">
            <button className="toggle-pill" type="button" onClick={() => applyQuickSlots(weekdaySlots([0, 1, 2, 3, 4], 20, 22))}>
              平日 20:00-22:00
            </button>
            <button className="toggle-pill" type="button" onClick={() => applyQuickSlots(weekdaySlots([0, 1, 2, 3, 4], 21, 23))}>
              平日 21:00-23:00
            </button>
            <button className="toggle-pill" type="button" onClick={() => applyQuickSlots(weekdaySlots([5, 6], 20, 23))}>
              週末 20:00-23:00
            </button>
          </div>
          <div className="slot-editor">
            <label>
              星期
              <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              開始
              <select value={startMinutes} onChange={(event) => setStartMinutes(Number(event.target.value))}>
                {startTimeOptions().map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutes(minutes)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              結束
              <select value={endMinutes} onChange={(event) => setEndMinutes(Number(event.target.value))}>
                {endTimeOptions().map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutes(minutes)}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={addSlot}>
              <Plus size={18} />
              新增
            </button>
          </div>
          <WeeklySlotGrid draftSlots={draftSlots} setDraftSlots={setDraftSlots} />
          <div className="form-submit-row">
            <button className="primary-button" onClick={save}>
              <CalendarCheck size={18} />
              送出本週可出時間
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function CandidateCard({
  slot,
  index,
  members,
  requiredMemberCount,
  actionLabel,
  onAction,
  disabledAction,
}: {
  slot: CandidateWindow;
  index: number;
  members: Member[];
  requiredMemberCount: number;
  actionLabel?: string;
  onAction?: () => void;
  disabledAction?: boolean;
}) {
  const status = getSessionStatus(slot, requiredMemberCount);
  const missingCount = Math.max(requiredMemberCount - slot.availableMembers.length, slot.unavailableMembers.length);
  return (
    <article
      aria-label={`${WEEKDAYS[slot.weekday]} ${formatRange(slot.startMinutes, slot.endMinutes)}，${formatMealsFromMinutes(slot.endMinutes - slot.startMinutes)}，${slot.availableMembers.length}/${requiredMemberCount} 人可出`}
      className="ranking-card"
    >
      <div className="session-badges">
        <span className="rank-number">第 {index + 1} 場</span>
        <span className="meal-badge">
          <Utensils size={14} />
          {formatMealsFromMinutes(slot.endMinutes - slot.startMinutes)}
        </span>
      </div>
      <div className="candidate-main">
        <div className="candidate-title-row">
          <h3>
            {WEEKDAYS[slot.weekday]} {formatRange(slot.startMinutes, slot.endMinutes)}
          </h3>
          <span className={`status-badge ${statusTone(status)}`}>{sessionStatusLabel(status)}</span>
        </div>
        <p>
          {slot.availableMembers.length}/{requiredMemberCount} 人可出
          {missingCount === 0 ? " · 全員到齊" : ` · 缺 ${missingCount} 人`}
        </p>
        <p>{slot.missingRoles.length ? `缺位置：${slot.missingRoles.join("、")}` : "位置完整"}</p>
        {actionLabel && onAction && (
          <button className="secondary-button candidate-action" disabled={disabledAction} onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
      <MemberChips label="可出" members={slot.availableMembers} tone="available" />
      <MemberChips label="不可出" members={slot.unavailableMembers} tone="missing" />
    </article>
  );
}

function WeeklySlotGrid({
  draftSlots,
  setDraftSlots,
}: {
  draftSlots: Array<Omit<Availability, "id" | "memberId">>;
  setDraftSlots: React.Dispatch<React.SetStateAction<Array<Omit<Availability, "id" | "memberId">>>>;
}) {
  return (
    <div className="weekly-slots">
      {WEEKDAYS.map((day, dayIndex) => {
        const daySlots = draftSlots.filter((slot) => slot.weekday === dayIndex);
        return (
          <article className="day-slot-card" key={day}>
            <strong>{day}</strong>
            {daySlots.length === 0 ? (
              <span className="muted">未設定</span>
            ) : (
              daySlots.map((slot) => {
                const slotIndex = draftSlots.indexOf(slot);
                return (
                  <button
                    aria-label={`移除 ${day} ${formatRange(slot.startMinutes, slot.endMinutes)}`}
                    className="slot-chip"
                    key={`${slot.weekday}-${slot.startMinutes}-${slot.endMinutes}-${slotIndex}`}
                    title="移除此區間"
                    onClick={() => setDraftSlots((current) => current.filter((_, index) => index !== slotIndex))}
                  >
                    {formatRange(slot.startMinutes, slot.endMinutes)}
                    <Trash2 size={14} />
                  </button>
                );
              })
            )}
          </article>
        );
      })}
    </div>
  );
}

function CompactMemberProfileFields({
  profile,
  setProfile,
}: {
  profile: MemberInput;
  setProfile: React.Dispatch<React.SetStateAction<MemberInput>>;
}) {
  return (
    <div className="form-grid">
      <label>
        角色暱稱
        <input
          autoFocus
          value={profile.displayName}
          onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))}
          maxLength={24}
          placeholder="例：光之豆芽"
        />
      </label>
      <label>
        職能
        <select
          value={profile.role}
          onChange={(event) => setProfile((current) => ({ ...current, role: event.target.value as MemberRole }))}
        >
          {MEMBER_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function weekdaySlots(weekdays: number[], startHour: number, endHour: number) {
  return weekdays.map((weekday) => ({
    weekday,
    startMinutes: startHour * 60,
    endMinutes: endHour * 60,
  }));
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "danger";
}) {
  return (
    <article aria-label={`${label} ${value}`} className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function rolesForMembers(members: Member[]) {
  const roleSet = new Set(members.map((member) => member.role));
  return MEMBER_ROLES.filter((role) => roleSet.has(role));
}

function missingOrUnfilledRoles(members: Member[], unfilledMembers: Member[]) {
  const joinedRoles = new Set(members.map((member) => member.role));
  const unfilledRoles = new Set(unfilledMembers.map((member) => member.role));
  return MEMBER_ROLES.filter((role) => !joinedRoles.has(role) || unfilledRoles.has(role));
}

function getNearPracticeSlots(candidateWindows: CandidateWindow[], selected: CandidateWindow[], totalMembers: number) {
  const selectedKeys = new Set(selected.map(candidateKey));
  return candidateWindows
    .filter((slot) => !selectedKeys.has(candidateKey(slot)))
    .filter((slot) => slot.availableMembers.length >= Math.max(1, totalMembers - 2))
    .filter((slot) => slot.unavailableMembers.length > 0 || slot.missingRoles.length > 0)
    .slice(0, 3);
}

function summarizeMissingRoles(slots: CandidateWindow[]) {
  const roleSet = new Set<string>();
  for (const slot of slots) {
    for (const role of slot.missingRoles) roleSet.add(role);
  }
  return roleSet.size ? [...roleSet].join("、") : "1-2 人";
}

function candidateKey(slot: Pick<CandidateWindow, "weekday" | "startMinutes" | "endMinutes">) {
  return `${slot.weekday}-${slot.startMinutes}-${slot.endMinutes}`;
}

function statusTone(status: ReturnType<typeof getSessionStatus>) {
  if (status === "ready") return "good";
  if (status === "needs_sub") return "warn";
  return "danger";
}

function useTeamBundle(slug: string) {
  const [bundle, setBundle] = useState<TeamBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      setBundle(await store.getTeamBySlug(slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取資料失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, [slug]);

  return { bundle, loading, error, reload };
}

function emptyMemberInput(role: MemberRole = "D1"): MemberInput {
  return {
    displayName: "",
    role,
    jobs: "",
    discordName: "",
    canSubstitute: false,
    notes: "",
  };
}

function roleToneClass(role: MemberRole) {
  if (role === "MT" || role === "ST") return "tank";
  if (role === "H1" || role === "H2") return "healer";
  return "dd";
}

function roleGroupLabel(role: MemberRole) {
  if (role === "MT" || role === "ST") return "坦";
  if (role === "H1" || role === "H2") return "補";
  return "DD";
}

function memberToInput(member: Member): MemberInput {
  return {
    displayName: member.displayName,
    role: member.role,
    jobs: "",
    discordName: "",
    canSubstitute: member.canSubstitute,
    notes: member.notes,
  };
}

function startTimeOptions() {
  return Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, index) => index * SLOT_MINUTES);
}

function endTimeOptions() {
  return Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, index) => (index + 1) * SLOT_MINUTES);
}

function MemberChips({ label, members, tone }: { label: string; members: Member[]; tone: "available" | "missing" }) {
  if (members.length === 0) return null;
  return (
    <div className="chip-group">
      <span>{label}</span>
      {members.map((member) => (
        <span className={`member-chip ${tone} ${roleToneClass(member.role)}`} key={member.id}>
          {roleLabel(member.role)} {member.displayName}
        </span>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

function StatusPanel({ text }: { text: string }) {
  return (
    <section className="narrow-page">
      <div className="panel">
        <p>{text}</p>
      </div>
    </section>
  );
}
