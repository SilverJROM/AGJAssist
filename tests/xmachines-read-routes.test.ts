import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium } from "@playwright/test";
import { JSDOM } from "jsdom";
import { DatabaseService } from "../src/db/database.js";
import { createApiServer, type ApiServices } from "../src/api/server.js";
import { AppConfig } from "../src/config/config.js";
import { renderFleetOverview, renderMachineCostDetail } from "../src/web/public/xmachines-cost-view.js";

const VALIDATION = path.resolve("xmachines/projcore-run-2026-09-25/validation");
const ENV_KEYS = [
  "XMACHINES_STATUS_FIXTURE",
  "XMACHINES_TELEMETRY_FIXTURE",
  "XMAC_CONF",
  "XMAC_STATE",
  "XMAC_LOG",
  "XMACHINES_PROTECTED_FIXTURE_DIR",
  "XMACHINES_USE_REGISTRY",
  "XMACHINES_OBSERVED_FLEET",
] as const;

const OWNER_TOKEN = "owner-token";
const VIEWER_TOKEN = "viewer-token";

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: "123:ABC",
      authorizedUserId: 1,
      authorizedChatIds: [1],
      testMode: true,
      updateMode: "polling",
      webhookUrl: null,
      webhookPath: "/api/telegram/webhook",
      webhookSecretToken: "s"
    },
    runtime: {
      workspaceRoot: "/tmp",
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1
    },
    api: {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: "s",
      sessionExpiryHours: 24
    },
    db: { path: ":memory:" },
    projects: { root: "/tmp" },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: "t" }
  };
}

function stubServices(): ApiServices {
  return {
    authService: {
      verifyToken: (t: string) => {
        if (t === OWNER_TOKEN) return { id: 1, role: "owner", username: "owner" };
        if (t === VIEWER_TOKEN) return { id: 2, role: "viewer", username: "viewer" };
        return null;
      }
    } as any,
    projectService: {} as any,
    safetyService: {} as any,
    auditService: {} as any,
    tmuxService: {} as any,
    tmuxStreamManager: {} as any,
    db: new DatabaseService(":memory:"),
    delegationService: {} as any,
    noteService: {} as any,
    planService: {} as any,
    taskService: {} as any,
    fileService: {} as any,
    stepTemplateService: {} as any,
    personalTaskService: {} as any,
    reminderService: {} as any,
    agentAssignmentService: {} as any,
  };
}

describe("xmachines read routes C1", () => {
  let app: any;
  let db: DatabaseService;

  beforeEach(async () => {
    db = new DatabaseService(":memory:");
    const services = stubServices();
    app = await createApiServer(minimalConfig(), services);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const ownerHeaders = () => ({
    authorization: `Bearer ${OWNER_TOKEN}`,
    host: "agjasst.silverjrom.app",
    origin: "https://agjasst.silverjrom.app",
  });

  const viewerHeaders = () => ({
    authorization: `Bearer ${VIEWER_TOKEN}`,
    host: "agjasst.silverjrom.app",
    origin: "https://agjasst.silverjrom.app",
  });

  it("A2c: GET telemetry returns 401 without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: {} });
    expect(res.statusCode).toBe(401);
  });

  it("A2c: GET telemetry returns 403 for non-owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: viewerHeaders() });
    expect(res.statusCode).toBe(403);
  });

  it("A2c: GET telemetry returns 200 for owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("machines");
    expect(Array.isArray(body.machines)).toBe(true);
    expect(body).toHaveProperty("armed");
    expect(body).toHaveProperty("mode");
  });

  it("A2c: GET machine detail returns 401 without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: {} });
    expect(res.statusCode).toBe(401);
  });

  it("A2c: GET machine detail returns 403 for non-owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: viewerHeaders() });
    expect(res.statusCode).toBe(403);
  });

  it("A2c: GET machine detail returns 200 for owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("machine");
    expect(body.machine).toHaveProperty("name");
  });

  it("B1a/B1b/B1c/B1d/B1e/B1f: registry fixture overview and detail render service literals", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "c1-read-"));
    try {
      const statusPath = path.join(root, "status.txt");
      const metricsPath = path.join(root, "metrics.json");
      const confPath = path.join(root, "machines.conf");
      const stateDir = path.join(root, "xmac-state");
      fs.writeFileSync(statusPath, [
        "quartz  192.0.2.40  UP  leases=(hold-c1-ember)  compute",
        "slate  192.0.2.41  DOWN  leases=()  storage",
        "",
      ].join("\n"));
      fs.writeFileSync(confPath, [
        "quartz|192.0.2.40|02:00:00:00:00:40|agjrom|compute|printf 'encoder pid 4242'",
        "slate|192.0.2.41|02:00:00:00:00:41|agjrom|storage|true",
        "",
      ].join("\n"));
      fs.mkdirSync(path.join(stateDir, "leases", "quartz"), { recursive: true });
      fs.writeFileSync(path.join(stateDir, "leases", "quartz", "hold-c1-ember"), "");
      fs.writeFileSync(metricsPath, JSON.stringify({
        quartz: {
          gpuTempsC: [61, 73],
          gpuPowerWatts: [120, 67],
          uptime: "9d 4h 12m",
          freshness: "fresh",
          provenance: "collector-cli",
          sampleAge: "41s",
          cpuTemp: 48,
          boardTemp: 39,
        },
        slate: {
          gpuTempsC: [61, 73],
          gpuPowerWatts: [120, 67],
          uptime: "9d 4h 12m",
          freshness: "stale",
          sampleAge: "900s",
        },
      }));
      process.env.XMACHINES_STATUS_FIXTURE = statusPath;
      process.env.XMACHINES_TELEMETRY_FIXTURE = metricsPath;
      process.env.XMAC_CONF = confPath;
      process.env.XMAC_STATE = stateDir;
      delete process.env.XMAC_LOG;
      delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
      delete process.env.XMACHINES_USE_REGISTRY;
      delete process.env.XMACHINES_OBSERVED_FLEET;

      const overviewRes = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: ownerHeaders() });
      expect(overviewRes.statusCode).toBe(200);
      const overview = overviewRes.json();
      const names = overview.machines.map((machine: { name: string }) => machine.name);
      expect(names).toEqual(["quartz", "slate"]);
      for (const synthetic of ["gpu", "hdd", "gpu2", "media"]) {
        expect(names).not.toContain(synthetic);
      }
      const quartz = overview.machines[0];
      const slate = overview.machines[1];
      expect(quartz.state).toBe("up");
      expect(quartz.offline).toBe(false);
      expect(quartz.gpuTemp).toBe(73);
      expect(quartz.gpuCount).toBe(2);
      expect(quartz.gpusBusy).toBe(2);
      expect(quartz.powerWatts).toBe(187);
      expect(quartz.uptime).toBe("9d 4h 12m");
      expect(quartz.freshness).toBe("fresh");
      expect(quartz.sampleAge).toBe("41s");
      expect(quartz.provenance).toBe("collector-cli");
      expect(quartz.telemetry).toEqual({ gpuTempMax: 73, powerWatts: 187, uptime: "9d 4h 12m" });
      expect(quartz.busy).toEqual({
        busyCheckOutput: "encoder pid 4242",
        leaseNames: ["hold-c1-ember"],
        isBusy: true,
        refusalExplanation: "busy: encoder pid 4242; leases: hold-c1-ember",
      });
      expect(slate.state).toBe("down");
      expect(slate.offline).toBe(true);
      expect(slate.freshness).toBe("stale");
      expect(slate.sampleAge).toBe("900s");
      expect(slate.provenance).toBe("xmac-registry");
      expect(slate.telemetry).toEqual({ gpuTempMax: null, powerWatts: null, uptime: null });
      expect(slate.busy).toEqual({
        busyCheckOutput: "",
        leaseNames: [],
        isBusy: false,
        refusalExplanation: "",
      });

      const quartzRes = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz", headers: ownerHeaders() });
      expect(quartzRes.statusCode).toBe(200);
      const quartzBody = quartzRes.json();
      expect(quartzBody.machine.gpuTemp).toBe(73);
      expect(quartzBody.machine.powerWatts).toBe(187);
      expect(quartzBody.machine.uptime).toBe("9d 4h 12m");
      expect(quartzBody.machine.freshness).toBe("fresh");
      expect(quartzBody.machine.provenance).toBe("collector-cli");
      expect(quartzBody.machine.telemetry).toEqual({ gpuTempMax: 73, powerWatts: 187, uptime: "9d 4h 12m" });
      expect(quartzBody.machine.busy.busyCheckOutput).toBe("encoder pid 4242");
      expect(quartzBody.machine.busy.leaseNames).toEqual(["hold-c1-ember"]);

      const slateRes = await app.inject({ method: "GET", url: "/api/xmachines/machines/slate", headers: ownerHeaders() });
      expect(slateRes.statusCode).toBe(200);
      const slateBody = slateRes.json();
      expect(slateBody).not.toHaveProperty("error");
      expect(JSON.stringify(slateBody)).not.toContain("unknown-machine");
      expect(slateBody.machine.state).toBe("down");
      expect(slateBody.machine.offline).toBe(true);
      expect(slateBody.machine.freshness).toBe("stale");
      expect(slateBody.machine.provenance).toBe("xmac-registry");
      expect(slateBody.machine.telemetry).toEqual({ gpuTempMax: null, powerWatts: null, uptime: null });

      const missing = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: ownerHeaders() });
      expect(missing.statusCode).toBe(404);

      const overviewMarkup = renderFleetOverview(overview);
      const overviewDoc = new JSDOM(`<!doctype html><body>${overviewMarkup}</body>`).window.document;
      const cards = overviewDoc.querySelectorAll('[data-testid="xmachines-fleet-card"]');
      expect(cards).toHaveLength(2);
      expect(cards[0].getAttribute("aria-label")).toBe("quartz up");
      expect(cards[0].textContent).toContain("up");
      expect(cards[0].textContent).not.toContain("offline");
      expect(cards[0].querySelector('[data-testid="xmachines-gpu-temp"]')?.textContent).toBe("73°C");
      expect(cards[0].querySelector('[data-testid="xmachines-gpu-count"]')?.textContent).toBe("2/2");
      expect(cards[0].querySelector('[data-testid="xmachines-box-temp"]')?.textContent).toBe("39°C");
      expect(cards[0].querySelector('[data-testid="xmachines-power-draw"]')?.textContent).toBe("187 W");
      expect(cards[0].querySelector('[data-testid="xmachines-uptime"]')?.textContent).toBe("9d 4h 12m");
      expect(cards[0].querySelector('[data-testid="xmachines-freshness"]')?.textContent).toBe("fresh");
      expect(cards[0].querySelector('[data-testid="xmachines-provenance"]')?.textContent).toBe("collector-cli");
      expect(cards[0].querySelector('[data-testid="xmachines-busy"]')?.textContent).toBe("encoder pid 4242");
      expect(cards[0].querySelector('[data-testid="xmachines-leases"]')?.textContent).toBe("hold-c1-ember");
      expect(cards[1].getAttribute("aria-label")).toBe("slate offline");
      expect(cards[1].textContent).toContain("offline");
      expect(cards[1].textContent?.toLowerCase()).not.toContain("error");
      expect(cards[1].querySelector('[role="alert"]')).toBeNull();
      expect(cards[1].querySelector('[data-testid="xmachines-gpu-temp"]')).toBeNull();
      expect(cards[1].querySelector('[data-testid="xmachines-gpu-count"]')).toBeNull();
      expect(cards[1].querySelector('[data-testid="xmachines-box-temp"]')).toBeNull();
      expect(cards[1].querySelector('[data-testid="xmachines-power-draw"]')).toBeNull();
      expect(cards[1].querySelector('[data-testid="xmachines-uptime"]')).toBeNull();
      expect(cards[1].textContent).not.toContain("73");
      expect(cards[1].textContent).not.toContain("9d 4h 12m");
      expect(cards[1].querySelector('[data-testid="xmachines-freshness"]')?.textContent).toBe("stale");
      expect(cards[1].querySelector('[data-testid="xmachines-provenance"]')?.textContent).toBe("xmac-registry");

      const quartzMarkup = renderMachineCostDetail(quartzBody);
      const quartzDoc = new JSDOM(`<!doctype html><body>${quartzMarkup}</body>`).window.document;
      const quartzDetail = quartzDoc.querySelector('[data-testid="xmachines-machine-detail"]');
      expect(quartzDetail?.querySelector('[data-testid="xmachines-power-state"]')?.textContent).toBe("up");
      expect(quartzDetail?.querySelector('[data-testid="xmachines-gpu-temp"]')?.textContent).toBe("73°C");
      expect(quartzDetail?.querySelector('[data-testid="xmachines-board-temp"]')?.textContent).toBe("39°C");
      expect(quartzDetail?.querySelector('[data-testid="xmachines-power-draw"]')?.textContent).toBe("187 W");
      expect(quartzDetail?.querySelector('[data-testid="xmachines-uptime"]')?.textContent).toBe("9d 4h 12m");
      expect(quartzDetail?.querySelector('[data-testid="xmachines-freshness"]')?.textContent).toBe("fresh");
      expect(quartzDetail?.querySelector('[data-testid="xmachines-provenance"]')?.textContent).toBe("collector-cli");
      expect(quartzDetail?.querySelector('[data-testid="xmachines-busy"]')?.textContent).toBe("encoder pid 4242");

      const slateMarkup = renderMachineCostDetail(slateBody);
      const slateDoc = new JSDOM(`<!doctype html><body>${slateMarkup}</body>`).window.document;
      const slateDetail = slateDoc.querySelector('[data-testid="xmachines-machine-detail"]');
      expect(slateDetail?.querySelector('[data-testid="xmachines-power-state"]')?.textContent).toBe("offline");
      expect(slateDetail?.textContent).toContain("offline");
      expect(slateDetail?.textContent?.toLowerCase()).not.toContain("error");
      expect(slateDetail?.querySelector('[role="alert"]')).toBeNull();
      expect(slateDetail?.querySelector('[data-testid="xmachines-gpu-temp"]')).toBeNull();
      expect(slateDetail?.querySelector('[data-testid="xmachines-power-draw"]')).toBeNull();
      expect(slateDetail?.querySelector('[data-testid="xmachines-uptime"]')).toBeNull();
      expect(slateDetail?.textContent).not.toContain("73");
      expect(slateDetail?.textContent).not.toContain("9d 4h 12m");
      expect(slateDetail?.querySelector('[data-testid="xmachines-freshness"]')?.textContent).toBe("stale");
      expect(slateDetail?.querySelector('[data-testid="xmachines-provenance"]')?.textContent).toBe("xmac-registry");

      const appSrc = fs.readFileSync(path.resolve("src/web/public/app.js"), "utf8");
      expect(appSrc).toContain("renderFleetOverview(payload)");
      expect(appSrc).toContain("renderMachineCostDetail(payload)");

      fs.mkdirSync(VALIDATION, { recursive: true });
      const overviewHtml = path.join(VALIDATION, "C1-overview-a2.html");
      const overviewPng = path.join(VALIDATION, "C1-overview-a2.png");
      const downHtml = path.join(VALIDATION, "C1-down-detail-a2.html");
      const downPng = path.join(VALIDATION, "C1-down-detail-a2.png");
      const pageShell = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px sans-serif;background:#fff;color:#111;margin:24px}</style></head><body>${body}</body></html>`;
      fs.writeFileSync(overviewHtml, pageShell("Fleet overview", overviewMarkup));
      fs.writeFileSync(downHtml, pageShell("Slate offline", slateMarkup));

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
        await page.goto(pathToFileURL(overviewHtml).href);
        const overviewText = await page.getByTestId("xmachines-fleet-overview").innerText();
        expect(overviewText).toContain("quartz");
        expect(overviewText).toContain("up");
        expect(overviewText).toContain("73°C");
        expect(overviewText).toContain("187 W");
        expect(overviewText).toContain("9d 4h 12m");
        expect(overviewText).toContain("slate");
        expect(overviewText).toContain("offline");
        await page.screenshot({ path: overviewPng, fullPage: true });
        await page.goto(pathToFileURL(downHtml).href);
        const downText = await page.getByTestId("xmachines-machine-detail").innerText();
        expect(downText).toContain("offline");
        expect(downText.toLowerCase()).not.toContain("error");
        expect(await page.getByTestId("xmachines-machine-detail").locator('[role="alert"]').count()).toBe(0);
        await page.screenshot({ path: downPng, fullPage: true });
      } finally {
        await browser.close();
      }
      expect(fs.statSync(overviewPng).size).toBeGreaterThan(500);
      expect(fs.statSync(downPng).size).toBeGreaterThan(500);
    } finally {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
