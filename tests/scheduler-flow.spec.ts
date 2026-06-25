import { expect, test } from "@playwright/test";

test.describe("FF14 固定團排班", () => {
  test("團長建立零式/絕本固定團，8 個職位填表後排班達標", async ({ page }) => {
    const teamName = `E2E 固定團 ${Date.now()}`;

    await createTeam(page, teamName);
    await expect(page.getByRole("heading", { name: teamName })).toBeVisible();
    await expect(page.getByText("需求 MT / ST / H1 / H2 / D1 / D2 / D3 / D4")).toBeVisible();
    await expect(page.getByText("0/8 人已回覆")).toBeVisible();

    const roles = ["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"];
    for (const [index, role] of roles.entries()) {
      await addMemberAvailability(page, `${role} ${index + 1}`, role, [
        ["週一", "20:00", "22:30"],
        ["週二", "20:00", "22:30"],
        ["週三", "20:00", "22:30"],
        ["週四", "20:00", "22:30"],
        ["週五", "20:00", "22:30"],
      ]);
    }

    await expect(page.getByText("8/8 人已回覆")).toBeVisible();
    await expect(page.getByText("本週可練 5 場")).toBeVisible();
    await expect(page.getByLabel("週一 20:00-22:30，5飯，8/8 人可出")).toBeVisible();
    await expect(page.getByLabel("週二 20:00-22:30，5飯，8/8 人可出")).toBeVisible();
    await expect(page.getByLabel("週三 20:00-22:30，5飯，8/8 人可出")).toBeVisible();
    await expect(page.getByLabel("週四 20:00-22:30，5飯，8/8 人可出")).toBeVisible();
    await expect(page.getByLabel("週五 20:00-22:30，5飯，8/8 人可出")).toBeVisible();
    await expect(page.locator(".ranking-card").filter({ hasText: "5飯" })).toHaveCount(5);
    await expect(page.locator(".ranking-card").filter({ hasText: "8/8 人可出" })).toHaveCount(5);
  });

  test("成員標記本週無法出團後，回覆進度顯示該位置狀態", async ({ page }) => {
    const teamName = `E2E 無法出團 ${Date.now()}`;
    await createTeam(page, teamName);

    await addMemberAvailability(page, "MT 無法出團測試", "MT", [["週一", "20:00", "22:00"]]);
    await page.getByTitle("編輯").click();
    await page.getByLabel("本週無法出團").check();
    await page.getByRole("button", { name: "儲存" }).click();
    await page.getByRole("button", { name: "回隊伍頁" }).click();

    await expect(page.getByText("本週無法：MT")).toBeVisible();
    await expect(page.getByText("本週無法", { exact: true })).toBeVisible();
  });

  test("主頁可直接複製不依賴目標場次的 DC 公告", async ({ page, context }) => {
    const teamName = `E2E 公告 ${Date.now()}`;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await createTeam(page, teamName);
    for (const role of ["MT", "H1", "H2", "D1", "D2", "D3", "D4"]) {
      await addMemberAvailability(page, `${role} 公告測試`, role, [["週一", "20:00", "22:00"]]);
    }

    await expect(page.getByText("本週可練 1 場")).toBeVisible();
    await page.getByRole("button", { name: "複製 DC 公告" }).click();
    const announcement = await page.evaluate(() => navigator.clipboard.readText());
    expect(announcement).toContain(teamName);
    expect(announcement).toContain("週一 20:00-22:00");
    expect(announcement).toContain("本週可練場次");
    expect(announcement).toContain("需補位");
    expect(announcement).toContain("缺位置：ST");
    expect(announcement).not.toContain("目標：本週");
    expect(announcement).toContain("隊伍頁");
  });
});

async function createTeam(
  page: import("@playwright/test").Page,
  teamName: string,
) {
  await page.goto("/");
  await page.getByLabel("隊伍名稱").fill(teamName);
  await page.getByLabel("團本內容").fill("M5S-M8S");
  await page.getByRole("button", { name: "建立隊伍頁" }).click();
  await expect(page).toHaveURL(/\/team\/.+/);
}

async function addMemberAvailability(
  page: import("@playwright/test").Page,
  name: string,
  role: string,
  slots: Array<[string, string, string]>,
) {
  await page.getByRole("button", { name: `填 ${role}` }).click();
  await page.getByLabel("角色暱稱").fill(name);
  await expect(page.getByLabel("職能")).toHaveValue(role);
  await page.getByLabel("職能").selectOption(role);
  await page.getByLabel("常用職業").fill(role === "MT" || role === "ST" ? "戰士" : "測試職業");
  await page.getByLabel("DC 名稱").fill(`${name}@discord`);
  await page.getByRole("button", { name: "加入並填寫時間" }).click();

  await expect(page.getByRole("heading", { name: `${name} 的本週填表` })).toBeVisible();
  for (const [weekday, start, end] of slots) {
    await page.getByLabel("星期").selectOption({ label: weekday });
    await page.getByLabel("開始").selectOption({ label: start });
    await page.getByLabel("結束").selectOption({ label: end });
    await page.getByRole("button", { name: "新增" }).click();
    await expect(page.getByLabel(`移除 ${weekday} ${start}-${end}`)).toBeVisible();
  }
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByText("已儲存")).toBeVisible();
  await page.getByRole("button", { name: "回隊伍頁" }).click();
}
