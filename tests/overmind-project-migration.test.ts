import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../src/db/database.js";
import {
  analyzeCompletedWorkflows,
  commitProposals,
  deriveLabelPrefix,
  formatDryRunOutput
} from "../src/tools/propose-overmind-projects.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("propose-overmind-projects", () => {
  it("derives app paths, groups completed workflows, marks slug conflicts, and ignores non-completed rows", async () => {
    const { db, root } = fixtureDb();
    try {
      const appAlpha = appDir(root, "alpha", "project_specs.md");
      const appGit = appDir(root, "gitonly", ".git");
      const appSharedOne = appDir(root, "shared-one", "project_specs.md");
      const appSharedTwo = appDir(root, "shared-two", "project_specs.md");
      const alphaRunOne = mkdirp(path.join(appAlpha, "runs", "one"));
      const alphaRunTwo = mkdirp(path.join(appAlpha, "runs", "two"));
      const gitRun = mkdirp(path.join(appGit, "deep", "run"));
      const sharedOneRun = mkdirp(path.join(appSharedOne, "run"));
      const sharedTwoRun = mkdirp(path.join(appSharedTwo, "run"));
      const missingRun = path.join(root, "missing", "run");

      insertWorkflow(db, {
        id: 1,
        label: "alpha-b1 import",
        coordinator_session: "alpha-old",
        run_dir: alphaRunOne,
        status: "completed",
        ended_at: "2026-06-01T10:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 2,
        label: "alpha-b2 verify",
        coordinator_session: "alpha-new",
        run_dir: alphaRunTwo,
        status: "completed",
        ended_at: "2026-06-01T11:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 3,
        label: "gitonly-run1",
        coordinator_session: "git-parent",
        run_dir: gitRun,
        status: "completed",
        ended_at: "2026-06-01T09:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 4,
        label: "shared-b1",
        coordinator_session: "shared-one-parent",
        run_dir: sharedOneRun,
        status: "completed",
        ended_at: "2026-06-01T08:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 5,
        label: "shared-b2",
        coordinator_session: "shared-two-parent",
        run_dir: sharedTwoRun,
        status: "completed",
        ended_at: "2026-06-01T08:30:00.000Z"
      });
      insertWorkflow(db, {
        id: 6,
        label: "gone-b1",
        coordinator_session: "gone-parent",
        run_dir: missingRun,
        status: "completed",
        ended_at: "2026-06-01T07:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 7,
        label: "alpha-active",
        coordinator_session: "active-parent",
        run_dir: alphaRunOne,
        status: "active",
        ended_at: null
      });
      insertWorkflow(db, {
        id: 8,
        label: "alpha-working",
        coordinator_session: "working-parent",
        run_dir: alphaRunOne,
        status: "working",
        ended_at: null
      });

      const analysis = await analyzeCompletedWorkflows(db);
      const alpha = analysis.proposals.find((proposal) => proposal.app_path === fs.realpathSync(appAlpha));
      const gitonly = analysis.proposals.find((proposal) => proposal.app_path === fs.realpathSync(appGit));
      const shared = analysis.proposals.filter((proposal) => proposal.slug === "shared");

      expect(alpha).toMatchObject({
        slug: "alpha",
        parent_session: "alpha-new",
        source_workflow_id: 2,
        workflow_ids: [1, 2],
        completed_count: 2,
        slug_conflict: false,
        commit_eligible: true
      });
      expect(gitonly).toMatchObject({
        slug: "gitonly",
        app_path: fs.realpathSync(appGit),
        parent_session: "git-parent",
        workflow_ids: [3],
        commit_eligible: true
      });
      expect(shared).toHaveLength(2);
      expect(shared.every((proposal) => proposal.slug_conflict)).toBe(true);
      expect(shared.every((proposal) => !proposal.commit_eligible)).toBe(true);
      expect(analysis.review_needed).toEqual([
        {
          workflow_id: 6,
          label: "gone-b1",
          run_dir: missingRun,
          reason: "missing-run-dir"
        }
      ]);
      expect(analysis.skipped_statuses).toEqual(["active", "working"]);

      const output = formatDryRunOutput(analysis, "http://127.0.0.1:3999");
      expect(output).toContain("# DRY RUN: no HTTP requests were executed.");
      expect(output).toContain("/api/overmind/projects");
      expect(output).toContain('"source_workflow_id": 2');
      expect(output).toContain("review-needed: workflow 6");
      expect(output).not.toContain("active-parent");
      expect(output).not.toContain("working-parent");
    } finally {
      db.close();
    }
  });

  it("keeps label-prefix slug extraction conservative", () => {
    expect(deriveLabelPrefix("AGJ-b12m migration")).toBe("agj");
    expect(deriveLabelPrefix("lkcamp-12: phase")).toBe("lkcamp");
    expect(deriveLabelPrefix("app-two setup")).toBe("app-two");
    expect(deriveLabelPrefix(null)).toBeNull();
  });

  it("commit mode excludes conflict groups and stops on 409/403 failures", async () => {
    const analysis = {
      review_needed: [{ workflow_id: 10, label: "missing", run_dir: "/tmp/missing", reason: "missing-run-dir" as const }],
      skipped_statuses: ["active"],
      proposals: [
        proposal("ok-one", "/tmp/ok-one", true, false),
        proposal("ok-two", "/tmp/ok-two", true, false),
        proposal("dupe", "/tmp/dupe-a", false, true)
      ]
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (!init?.method) {
        return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      }
      if (String(init.body).includes("ok-two")) {
        return new Response("duplicate", { status: 409 });
      }
      return new Response(JSON.stringify({ project: { slug: "ok-one" } }), { status: 201 });
    };

    const summary = await commitProposals(
      analysis,
      { baseUrl: "http://127.0.0.1:3999", ownerToken: "owner.jwt" },
      fetchStub
    );

    expect(summary.ok).toBe(false);
    expect(summary.created).toEqual([{ slug: "ok-one", status: 201 }]);
    expect(summary.failed).toEqual({ slug: "ok-two", status: 409, body: "duplicate" });
    expect(summary.skipped).toEqual([
      { slug: "dupe", app_path: "/tmp/dupe-a", reason: "slug_conflict" },
      { app_path: "/tmp/missing", reason: "review-needed:missing-run-dir" }
    ]);
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(2);
    expect(calls.some((call) => String(call.init?.body).includes("dupe"))).toBe(false);
  });
});

function fixtureDb(): { db: DatabaseService; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-project-migration-"));
  tempRoots.push(root);
  return {
    db: new DatabaseService(path.join(root, "fixture.sqlite")),
    root
  };
}

function appDir(root: string, name: string, marker: "project_specs.md" | ".git"): string {
  const dir = mkdirp(path.join(root, name));
  if (marker === "project_specs.md") {
    fs.writeFileSync(path.join(dir, "project_specs.md"), "# spec\n");
  } else {
    mkdirp(path.join(dir, ".git"));
  }
  return dir;
}

function mkdirp(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function insertWorkflow(
  db: DatabaseService,
  input: {
    id: number;
    label: string;
    coordinator_session: string;
    run_dir: string;
    status: string;
    ended_at: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO overmind_workflows (
      id,
      label,
      coordinator_session,
      run_dir,
      status,
      tasks,
      ended_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, '[]', ?, '2026-06-01T00:00:00.000Z', ?)`
  ).run(
    input.id,
    input.label,
    input.coordinator_session,
    input.run_dir,
    input.status,
    input.ended_at,
    input.ended_at ?? "2026-06-01T00:00:00.000Z"
  );
}

function proposal(slug: string, appPath: string, commitEligible: boolean, slugConflict: boolean) {
  return {
    slug,
    slug_conflict: slugConflict,
    app_path: appPath,
    parent_session: `${slug}-parent`,
    source_workflow_id: 1,
    source_completed_at: "2026-06-01T00:00:00.000Z",
    workflow_ids: [1],
    completed_count: 1,
    label_prefix: slug,
    commit_eligible: commitEligible,
    body: {
      slug,
      app_path: appPath,
      parent_session: `${slug}-parent`,
      notes: "test"
    }
  };
}
