import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMatrix, readOnlyViolation } from "../../scripts/xmachines-contract-probe.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SPY = path.join(REPO, "tests/helpers/xmac-argv-spy.sh");
const MATRIX = path.join(REPO, "xmachines/projcore-run-2026-09-25/capability-matrix.md");
const CONF = path.join(os.homedir(), ".config/agent-protocols/xmac/machines.conf");
const SOURCE = path.join(os.homedir(), ".config/agent-protocols/lib/xmac.sh");
const XMAC_LOG = path.join(os.homedir(), ".xmac/xmac.log");

const PROHIBITED = ["up", "down", "run", "claim", "release", "wakeonlan", "poweroff"] as const;
const CAPABILITIES = [
  "service-user permissions",
  "exact argv/subcommands",
  "exit codes",
  "stdout/stderr shape",
  "guard ordering",
  "xmac log format",
  "concurrent-call behavior",
  "force semantics",
] as const;
const BANNED_RAW = new Set(["present", "matches", "agjrom", "as above", "VERIFIED", "UNKNOWN", "--force present"]);

function confHosts(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("|")[0])
    .filter((name) => name.length > 0);
}

function confLine(text: string, host: string): string {
  const line = text.split("\n").find((row) => row.startsWith(`${host}|`));
  if (!line) throw new Error(`machines.conf has no row for ${host}`);
  return line;
}

function claimBlock(section: string, title: string): string {
  const marker = `### ${title}\n`;
  const start = section.indexOf(marker);
  expect(start, title).toBeGreaterThanOrEqual(0);
  const rest = section.slice(start + marker.length);
  const next = rest.search(/\n### /);
  return next === -1 ? rest : rest.slice(0, next);
}

function parseClaim(block: string): { command: string; ts: string; exitCode: string; verdict: string; raw: string } {
  const command = /^- command: `([^`]*)`/m.exec(block)?.[1] ?? "";
  const ts = /^- ts: (\S+)/m.exec(block)?.[1] ?? "";
  const exitCode = /^- exit: (\S+)/m.exec(block)?.[1] ?? "";
  const verdict = /^- verdict: (\S+)/m.exec(block)?.[1] ?? "";
  const raw = /^- raw:\n```\n([\s\S]*?)\n```/m.exec(block)?.[1] ?? "";
  return { command, ts, exitCode, verdict, raw };
}

function hostSections(md: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of md.split(/^## host: /m).slice(1)) {
    const end = part.indexOf("\n");
    const name = part.slice(0, end).trim();
    map.set(name, part);
  }
  return map;
}

describe("A0.1 xmac contract probe", () => {
  it("records only status and leases when the probe runs under the argv spy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a01-probe-"));
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, "xmac.sh"));
    const spyLog = path.join(dir, "spy.log");
    fs.writeFileSync(spyLog, "");
    const conf = path.join(dir, "machines.conf");
    fs.writeFileSync(conf, "specimen-host|203.0.113.50|00:11:22:33:44:55|not-agjrom|specimen-role|true\n");
    const out = path.join(dir, "capability-matrix.md");
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
    delete env.XMAC_ARGV_SPY_REAL;
    env.XMAC_ARGV_SPY_LOG = spyLog;
    env.XMAC_CONF = conf;
    env.XMAC_MATRIX_OUT = out;
    env.XMAC_SH_SOURCE = SOURCE;
    env.XMAC_LOG = XMAC_LOG;

    const proc = spawnSync(process.execPath, [path.join(REPO, "scripts/xmachines-contract-probe.mjs")], {
      cwd: REPO,
      env,
      encoding: "utf8",
    });
    expect(proc.status, proc.stderr).toBe(0);

    const spyText = fs.readFileSync(spyLog, "utf8");
    const gate = readOnlyViolation(spyText);
    expect(gate.ok).toBe(true);
    expect(gate.offending).toBeNull();
    expect(gate.records).toEqual([
      ["status", "specimen-host"],
      ["leases"],
    ]);
    for (const token of PROHIBITED) {
      expect(spyText.split("\t")).not.toContain(token);
    }
  });

  it("fails the read-only gate when a specimen argv is wakeonlan", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a01-neg-"));
    const spyLog = path.join(dir, "spy.log");
    fs.writeFileSync(spyLog, "");
    const env = { ...process.env, XMAC_ARGV_SPY_LOG: spyLog };
    delete env.XMAC_ARGV_SPY_REAL;
    const proc = spawnSync(SPY, ["wakeonlan", "specimen-host"], { env, encoding: "utf8" });
    expect(proc.status, proc.stderr).toBe(0);

    const spyText = fs.readFileSync(spyLog, "utf8");
    expect(spyText).toContain("wakeonlan");
    expect(spyText).toContain("specimen-host");
    const gate = readOnlyViolation(spyText);
    expect(gate.ok).toBe(false);
    expect(gate.offending).toBe("wakeonlan");
  });

  it("pastes fixture stdout and keeps an UNKNOWN verdict", () => {
    const ts = "2026-01-01T00:00:00Z";
    const row = (raw: string, verdict: "VERIFIED" | "ABSENT" | "UNKNOWN") => ({
      command: "fixture-command",
      ts,
      exit: 0,
      verdict,
      raw,
    });
    const md = buildMatrix({
      generatedAt: ts,
      configured: row("specimen-host", "VERIFIED"),
      hosts: [
        {
          name: "specimen-host",
          claims: {
            "service-user permissions": row(
              "specimen-host|203.0.113.50|00:11:22:33:44:55|not-agjrom|specimen-role|true",
              "VERIFIED",
            ),
            "exact argv/subcommands": row(
              "2026-01-01T00:00:00Z\tstatus\tspecimen-host\n2026-01-01T00:00:00Z\tleases",
              "VERIFIED",
            ),
            "exit codes": row("status_exit=0\nleases_exit=0", "VERIFIED"),
            "stdout/stderr shape": row("stdout:\nSPECIMEN-STDOUT-NOT-FROM-XMAC\nstderr:\n(0 bytes)", "VERIFIED"),
            "guard ordering": row("GUARD 1\nGUARD 2\nGUARD 3", "VERIFIED"),
            "xmac log format": row("2026-01-01T00:00:00Z UP specimen by=specimen@proc:test(1)", "VERIFIED"),
            "concurrent-call behavior": row("grep_exit=1\ndispatcher:\ncase", "UNKNOWN"),
            "force semantics": row('local force=""; [ "${2:-}" = "--force" ] && force=1', "VERIFIED"),
          },
        },
      ],
      spyLogRaw: "2026-01-01T00:00:00Z\tstatus\tspecimen-host\n2026-01-01T00:00:00Z\tleases\n",
    });
    expect(md).toContain("SPECIMEN-STDOUT-NOT-FROM-XMAC");
    expect(md).toContain("not-agjrom");
    const concurrent = claimBlock(md, "concurrent-call behavior");
    expect(parseClaim(concurrent).verdict).toBe("UNKNOWN");
    expect(md).toContain("an UNKNOWN verdict is not green control behavior.");
  });

  it("records raw evidence for every configured host", () => {
    const md = fs.readFileSync(MATRIX, "utf8");
    const conf = fs.readFileSync(CONF, "utf8");
    const logText = fs.readFileSync(XMAC_LOG, "utf8");
    const source = fs.readFileSync(SOURCE, "utf8");
    const expectedHosts = confHosts(conf);
    expect(expectedHosts).toEqual(expect.arrayContaining(["gpu", "hdd", "gpu2", "media"]));

    const sections = hostSections(md);
    expect([...sections.keys()].sort()).toEqual([...expectedHosts].sort());

    const byLine = logText.split("\n").find((line) => line.includes(" by="));
    const guard1 = source.split("\n").find((line) => line.includes("GUARD 1"));
    const forceLine = source.split("\n").find((line) => line.includes('= "--force"'));
    expect(byLine).toBeTruthy();
    expect(guard1).toBeTruthy();
    expect(forceLine).toBeTruthy();
    expect(md).toContain("an UNKNOWN verdict is not green control behavior.");

    for (const host of expectedHosts) {
      const section = sections.get(host);
      expect(section, host).toBeTruthy();
      for (const title of CAPABILITIES) {
        const parsed = parseClaim(claimBlock(section ?? "", title));
        expect(parsed.command, `${host} ${title} command`).not.toBe("");
        expect(parsed.ts, `${host} ${title} ts`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(parsed.exitCode, `${host} ${title} exit`).not.toBe("");
        expect(["VERIFIED", "ABSENT", "UNKNOWN"], `${host} ${title}`).toContain(parsed.verdict);
        expect(parsed.raw.length, `${host} ${title} raw`).toBeGreaterThan(0);
        expect(BANNED_RAW.has(parsed.raw.trim()), `${host} ${title} raw`).toBe(false);
      }
      const service = parseClaim(claimBlock(section ?? "", "service-user permissions"));
      expect(service.raw).toContain(confLine(conf, host));
      const argv = parseClaim(claimBlock(section ?? "", "exact argv/subcommands"));
      expect(argv.raw).toContain(`status\t${host}`);
      expect(argv.raw).toMatch(/\tleases$/m);
      const exits = parseClaim(claimBlock(section ?? "", "exit codes"));
      expect(exits.raw).toContain("status_exit=");
      expect(exits.raw).toContain("leases_exit=");
      expect(exits.raw).toContain(host);
      const stdio = parseClaim(claimBlock(section ?? "", "stdout/stderr shape"));
      expect(stdio.raw).toContain("stdout:");
      expect(stdio.raw).toContain("stderr:");
      expect(stdio.raw).toContain("leases=");
      expect(stdio.raw).toContain(host);
      const guard = parseClaim(claimBlock(section ?? "", "guard ordering"));
      expect(guard.raw).toContain(guard1);
      expect(guard.raw.indexOf("GUARD 1")).toBeLessThan(guard.raw.indexOf("GUARD 2"));
      expect(guard.raw.indexOf("GUARD 2")).toBeLessThan(guard.raw.indexOf("GUARD 3"));
      const logClaim = parseClaim(claimBlock(section ?? "", "xmac log format"));
      expect(logClaim.raw).toContain(byLine);
      const concurrent = parseClaim(claimBlock(section ?? "", "concurrent-call behavior"));
      expect(concurrent.verdict).toBe("UNKNOWN");
      expect(concurrent.raw).toContain("grep_exit=");
      expect(concurrent.raw).toContain("dispatcher:");
      const force = parseClaim(claimBlock(section ?? "", "force semantics"));
      expect(force.raw).toContain(forceLine);
    }

    const spyPart = md.split("## gateway-spy log")[1] ?? "";
    const spyLines = [...spyPart.matchAll(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\t(.+)$/gm)];
    expect(spyLines.length).toBeGreaterThan(0);
    for (const match of spyLines) {
      const argv = match[1].split("\t");
      expect(["status", "leases"]).toContain(argv[0]);
      for (const token of argv) expect(PROHIBITED).not.toContain(token);
    }
    for (const host of expectedHosts) {
      expect(spyLines.some((match) => match[1] === `status\t${host}`)).toBe(true);
    }
    expect(spyLines.some((match) => match[1] === "leases")).toBe(true);
  });
});
