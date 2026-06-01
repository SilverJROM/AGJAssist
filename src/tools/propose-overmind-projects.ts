import { DatabaseService } from "../db/database.js";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export interface CompletedWorkflowRow {
  id: number;
  label: string | null;
  coordinator_session: string | null;
  run_dir: string;
  ended_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface ReviewNeededRow {
  workflow_id: number;
  label: string | null;
  run_dir: string;
  reason: "missing-run-dir" | "run-dir-not-directory" | "no-project-marker" | "missing-parent-session";
}

export interface ProjectProposal {
  slug: string;
  suggested_slug?: string;
  slug_conflict: boolean;
  app_path: string;
  parent_session: string;
  source_workflow_id: number;
  source_completed_at: string | null;
  workflow_ids: number[];
  completed_count: number;
  label_prefix: string | null;
  commit_eligible: boolean;
  body: {
    slug: string;
    app_path: string;
    parent_session: string;
    notes: string;
  };
}

export interface MigrationAnalysis {
  proposals: ProjectProposal[];
  review_needed: ReviewNeededRow[];
  skipped_statuses: string[];
}

export interface CommitSummary {
  ok: boolean;
  created: Array<{ slug: string; status: number }>;
  skipped: Array<{ slug?: string; app_path?: string; reason: string }>;
  failed?: { slug: string; status: number; body: string };
}

interface CliOptions {
  dbPath: string;
  dryRun: boolean;
  commit: boolean;
  baseUrl: string;
  ownerToken: string;
}

type FetchLike = typeof fetch;

export function queryCompletedWorkflows(db: DatabaseService): CompletedWorkflowRow[] {
  return db
    .prepare(
      `SELECT id, label, coordinator_session, run_dir, ended_at, updated_at, created_at
       FROM overmind_workflows
       WHERE status = 'completed'
       ORDER BY id ASC`
    )
    .all() as CompletedWorkflowRow[];
}

export function querySkippedStatuses(db: DatabaseService): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT status
       FROM overmind_workflows
       WHERE status <> 'completed'
       ORDER BY status ASC`
    )
    .all() as { status: string }[];
  return rows.map((row) => row.status);
}

export async function deriveAppPath(runDir: string): Promise<string | ReviewNeededRow["reason"]> {
  let stat;
  try {
    stat = await fs.stat(runDir);
  } catch {
    return "missing-run-dir";
  }

  if (!stat.isDirectory()) return "run-dir-not-directory";

  const canonicalRunDir = await fs.realpath(runDir);
  const projectSpecsRoot = await findUpward(canonicalRunDir, async (dir) => fileExists(path.join(dir, "project_specs.md")));
  if (projectSpecsRoot) return projectSpecsRoot;

  const gitRoot = await findUpward(canonicalRunDir, async (dir) => directoryExists(path.join(dir, ".git")));
  return gitRoot ?? "no-project-marker";
}

export function deriveLabelPrefix(label: string | null): string | null {
  if (!label) return null;
  const firstToken = label.trim().toLowerCase().split(/[\s:/#]+/, 1)[0] ?? "";
  let slug = slugify(firstToken);
  if (!slug) return null;

  const parts = slug.split("-").filter(Boolean);
  while (parts.length > 1 && /^(?:b|batch|r|run|wf)?\d+[a-z]?$/.test(parts[parts.length - 1])) {
    parts.pop();
  }
  slug = parts.join("-");
  return slug || null;
}

export function chooseSlug(rows: CompletedWorkflowRow[], appPath: string): { slug: string; labelPrefix: string | null } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const prefix = deriveLabelPrefix(row.label);
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  let best: { prefix: string; count: number } | null = null;
  let tied = false;
  for (const [prefix, count] of counts) {
    if (!best || count > best.count) {
      best = { prefix, count };
      tied = false;
    } else if (count === best.count) {
      tied = true;
    }
  }

  if (best && !tied && (best.count > 1 || counts.size === 1)) {
    return { slug: best.prefix, labelPrefix: best.prefix };
  }

  return { slug: slugify(path.basename(appPath)) || "project", labelPrefix: best?.prefix ?? null };
}

export async function analyzeCompletedWorkflows(db: DatabaseService): Promise<MigrationAnalysis> {
  const completed = queryCompletedWorkflows(db);
  const skipped_statuses = querySkippedStatuses(db);
  const review_needed: ReviewNeededRow[] = [];
  const grouped = new Map<string, CompletedWorkflowRow[]>();

  for (const row of completed) {
    const derived = await deriveAppPath(row.run_dir);
    if (isReviewReason(derived)) {
      review_needed.push({
        workflow_id: row.id,
        label: row.label,
        run_dir: row.run_dir,
        reason: derived
      });
      continue;
    }
    const rows = grouped.get(derived) ?? [];
    rows.push(row);
    grouped.set(derived, rows);
  }

  const proposals = Array.from(grouped.entries()).map(([appPath, rows]) => buildProposal(appPath, rows));
  const slugCounts = new Map<string, number>();
  for (const proposal of proposals) {
    slugCounts.set(proposal.slug, (slugCounts.get(proposal.slug) ?? 0) + 1);
  }

  return {
    proposals: proposals
      .map((proposal) => {
        const slug_conflict = (slugCounts.get(proposal.slug) ?? 0) > 1;
        const suggested_slug = slug_conflict ? suggestConflictSlug(proposal.slug, proposal.app_path) : undefined;
        return {
          ...proposal,
          slug_conflict,
          suggested_slug,
          commit_eligible: proposal.commit_eligible && !slug_conflict
        };
      })
      .sort((a, b) => a.slug.localeCompare(b.slug) || a.app_path.localeCompare(b.app_path)),
    review_needed,
    skipped_statuses
  };
}

export function formatDryRunOutput(analysis: MigrationAnalysis, baseUrl = "http://127.0.0.1:3000"): string {
  const lines: string[] = [
    "# Overmind project migration proposals",
    "# DRY RUN: no HTTP requests were executed.",
    ""
  ];

  if (analysis.skipped_statuses.length > 0) {
    lines.push(`# Ignored non-completed workflow statuses: ${analysis.skipped_statuses.join(", ")}`, "");
  }

  for (const proposal of analysis.proposals) {
    lines.push(`## ${proposal.commit_eligible ? "proposal" : "skipped"}: ${proposal.slug}`);
    lines.push(JSON.stringify({
      ...proposal.body,
      source_workflow_id: proposal.source_workflow_id,
      workflow_ids: proposal.workflow_ids,
      slug_conflict: proposal.slug_conflict,
      suggested_slug: proposal.suggested_slug
    }, null, 2));
    lines.push(
      `curl -sS -X POST ${shellQuote(`${trimTrailingSlash(baseUrl)}/api/overmind/projects`)} ` +
      `-H 'Content-Type: application/json' ` +
      `-H 'Authorization: Bearer $OWNER_TOKEN' ` +
      `--data ${shellQuote(JSON.stringify(proposal.body))}`
    );
    lines.push("");
  }

  for (const row of analysis.review_needed) {
    lines.push(`## review-needed: workflow ${row.workflow_id}`);
    lines.push(JSON.stringify(row, null, 2));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function commitProposals(
  analysis: MigrationAnalysis,
  options: { baseUrl: string; ownerToken: string },
  fetchImpl: FetchLike = fetch
): Promise<CommitSummary> {
  const eligible = analysis.proposals.filter((proposal) => proposal.commit_eligible);
  const skipped = [
    ...analysis.proposals
      .filter((proposal) => !proposal.commit_eligible)
      .map((proposal) => ({
        slug: proposal.slug,
        app_path: proposal.app_path,
        reason: proposal.slug_conflict ? "slug_conflict" : "not_commit_eligible"
      })),
    ...analysis.review_needed.map((row) => ({
      app_path: row.run_dir,
      reason: `review-needed:${row.reason}`
    }))
  ];

  const baseUrl = trimTrailingSlash(options.baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${options.ownerToken}`
  };

  const existing = await fetchImpl(`${baseUrl}/api/overmind/projects`, { headers });
  if (existing.status === 403 || existing.status === 409) {
    return {
      ok: false,
      created: [],
      skipped,
      failed: { slug: "(preflight)", status: existing.status, body: await responseBody(existing) }
    };
  }
  if (!existing.ok) {
    return {
      ok: false,
      created: [],
      skipped,
      failed: { slug: "(preflight)", status: existing.status, body: await responseBody(existing) }
    };
  }

  const existingJson = await existing.json() as { projects?: Array<{ slug: string; app_path: string }> };
  const existingProjects = existingJson.projects ?? [];
  const preflightConflict = eligible.find((proposal) =>
    existingProjects.some((project) => project.slug === proposal.slug || project.app_path === proposal.app_path)
  );
  if (preflightConflict) {
    return {
      ok: false,
      created: [],
      skipped,
      failed: {
        slug: preflightConflict.slug,
        status: 409,
        body: "project slug or app_path already exists"
      }
    };
  }

  const created: CommitSummary["created"] = [];
  for (const proposal of eligible) {
    const response = await fetchImpl(`${baseUrl}/api/overmind/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify(proposal.body)
    });
    if (!response.ok || response.status === 403 || response.status === 409) {
      return {
        ok: false,
        created,
        skipped,
        failed: { slug: proposal.slug, status: response.status, body: await responseBody(response) }
      };
    }
    created.push({ slug: proposal.slug, status: response.status });
  }

  return { ok: true, created, skipped };
}

function buildProposal(appPath: string, rows: CompletedWorkflowRow[]): ProjectProposal {
  const sorted = [...rows].sort(compareMostRecent);
  const source = sorted[0];
  const { slug, labelPrefix } = chooseSlug(rows, appPath);
  const notes = `Proposed from completed overmind_workflows: ${rows.map((row) => row.id).join(", ")}. ` +
    `Parent source workflow: ${source.id}.`;

  return {
    slug,
    slug_conflict: false,
    app_path: appPath,
    parent_session: source.coordinator_session ?? "",
    source_workflow_id: source.id,
    source_completed_at: source.ended_at ?? source.updated_at ?? source.created_at ?? null,
    workflow_ids: rows.map((row) => row.id).sort((a, b) => a - b),
    completed_count: rows.length,
    label_prefix: labelPrefix,
    commit_eligible: Boolean(source.coordinator_session),
    body: {
      slug,
      app_path: appPath,
      parent_session: source.coordinator_session ?? "",
      notes
    }
  };
}

function compareMostRecent(a: CompletedWorkflowRow, b: CompletedWorkflowRow): number {
  const aTime = workflowTime(a);
  const bTime = workflowTime(b);
  if (aTime !== bTime) return bTime - aTime;
  return b.id - a.id;
}

function workflowTime(row: CompletedWorkflowRow): number {
  return Date.parse(row.ended_at ?? row.updated_at ?? row.created_at ?? "") || 0;
}

function isReviewReason(value: string): value is ReviewNeededRow["reason"] {
  return value === "missing-run-dir" ||
    value === "run-dir-not-directory" ||
    value === "no-project-marker" ||
    value === "missing-parent-session";
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function suggestConflictSlug(slug: string, appPath: string): string {
  const suffix = slugify(path.basename(appPath)) || "project";
  return suffix === slug ? `${slug}-2` : `${slug}-${suffix}`;
}

async function findUpward(start: string, matches: (dir: string) => Promise<boolean>): Promise<string | null> {
  let current = start;
  const root = path.parse(start).root;
  while (true) {
    if (await matches(current)) return current;
    if (current === root) return null;
    current = path.dirname(current);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

async function responseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: process.env.DB_PATH ?? "data/agjassist.db",
    dryRun: true,
    commit: false,
    baseUrl: process.env.OVERMIND_BASE_URL ?? "http://127.0.0.1:3000",
    ownerToken: process.env.OVERMIND_OWNER_TOKEN ?? ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };

    if (arg === "--db") options.dbPath = next();
    else if (arg === "--base-url") options.baseUrl = next();
    else if (arg === "--owner-token") options.ownerToken = next();
    else if (arg === "--commit") {
      options.commit = true;
      options.dryRun = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
      options.commit = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.commit && !options.ownerToken) {
    throw new Error("--commit requires --owner-token or OVERMIND_OWNER_TOKEN");
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(`Usage: npx tsx src/tools/propose-overmind-projects.ts [--db path] [--dry-run]\n`);
  process.stdout.write(`       npx tsx src/tools/propose-overmind-projects.ts --commit --owner-token <jwt> [--base-url url]\n\n`);
  process.stdout.write(`Dry-run is the default and executes no HTTP requests.\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!(await fileExists(options.dbPath))) {
    throw new Error(`Database not found: ${options.dbPath}`);
  }
  const db = new DatabaseService(options.dbPath);
  try {
    const analysis = await analyzeCompletedWorkflows(db);
    if (options.dryRun) {
      process.stdout.write(formatDryRunOutput(analysis, options.baseUrl));
      return;
    }

    const summary = await commitProposals(analysis, {
      baseUrl: options.baseUrl,
      ownerToken: options.ownerToken
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.ok) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
