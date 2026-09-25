#!/usr/bin/env node
// A0.1 read-only xmac contract probe.
// The gateway is invoked only as `xmac.sh` via PATH so an argv spy can sit in front.
// Subcommands used here are status and leases. Source and config are read, not executed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROHIBITED_ARGV = Object.freeze([
  "up",
  "down",
  "run",
  "claim",
  "release",
  "wakeonlan",
  "poweroff",
]);
export const ALLOWED_SUBCOMMANDS = Object.freeze(["status", "leases"]);
export const CLAIM_TITLES = Object.freeze([
  "service-user permissions",
  "exact argv/subcommands",
  "exit codes",
  "stdout/stderr shape",
  "guard ordering",
  "xmac log format",
  "concurrent-call behavior",
  "force semantics",
]);
const VERDICTS = new Set(["VERIFIED", "ABSENT", "UNKNOWN"]);

export function listHosts(confText) {
  const hosts = [];
  for (const line of confText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const name = trimmed.split("|")[0];
    if (name) hosts.push(name);
  }
  return hosts;
}

export function readOnlyViolation(spyText) {
  const records = [];
  for (const line of String(spyText).split("\n")) {
    if (!line.trim()) continue;
    records.push(line.split("\t").slice(1));
  }
  for (const argv of records) {
    for (const tok of argv) {
      if (PROHIBITED_ARGV.includes(tok)) {
        return { ok: false, offending: tok, records };
      }
    }
    const sub = argv[0] ?? "";
    if (!ALLOWED_SUBCOMMANDS.includes(sub)) {
      return { ok: false, offending: sub || "(empty)", records };
    }
  }
  return { ok: true, offending: null, records };
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function shQuote(s) {
  if (/^[A-Za-z0-9_./:=,-]+$/.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function shellJoin(argv) {
  return argv.map(shQuote).join(" ");
}

function run(argv) {
  const started = utcNow();
  const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" });
  const exit = result.status === null ? `signal:${result.signal ?? "none"}` : result.status;
  return {
    ts: started,
    exit,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error.message) : "",
    command: shellJoin(argv),
  };
}

function body(text) {
  if (!text) return "(0 bytes)";
  return text.replace(/\n$/, "");
}

function spySize(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return 0;
  return fs.statSync(logPath).size;
}

function spySlice(logPath, offset) {
  if (!logPath || !fs.existsSync(logPath)) return "";
  return fs.readFileSync(logPath, "utf8").slice(offset);
}

function claim(command, ts, exit, verdict, raw) {
  if (!VERDICTS.has(verdict)) {
    throw new Error(`verdict must be VERIFIED, ABSENT, or UNKNOWN (got ${verdict})`);
  }
  if (!String(raw).trim()) {
    throw new Error(`claim ${command} has empty raw evidence`);
  }
  return { command, ts, exit, verdict, raw: String(raw).replace(/\n$/, "") };
}

export function buildMatrix({ generatedAt, configured, hosts, spyLogRaw }) {
  const lines = [];
  lines.push("# capability-matrix — xmac contract probe A0.1");
  lines.push("");
  lines.push(`Probe timestamp: ${generatedAt}`);
  lines.push("Run: projcore-run-2026-09-25");
  lines.push("Slice: A0.1");
  lines.push("");
  lines.push("Control rule: an UNKNOWN verdict is not green control behavior.");
  lines.push("");
  lines.push("## configured hosts");
  emitClaim(lines, "configured hosts", configured);
  for (const host of hosts) {
    lines.push(`## host: ${host.name}`);
    lines.push("");
    for (const title of CLAIM_TITLES) {
      const row = host.claims[title];
      if (!row) throw new Error(`host ${host.name} missing claim ${title}`);
      emitClaim(lines, title, row);
    }
  }
  lines.push("## gateway-spy log");
  lines.push("");
  lines.push("Read back from the argv spy sink after the probe's xmac invocations. The probe does not author this log.");
  lines.push("");
  lines.push("```");
  lines.push(String(spyLogRaw ?? "").replace(/\n$/, ""));
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function emitClaim(lines, title, row) {
  if (!VERDICTS.has(row.verdict)) {
    throw new Error(`verdict must be VERIFIED, ABSENT, or UNKNOWN (got ${row.verdict})`);
  }
  lines.push(`### ${title}`);
  lines.push(`- command: \`${row.command}\``);
  lines.push(`- ts: ${row.ts}`);
  lines.push(`- exit: ${row.exit}`);
  lines.push(`- verdict: ${row.verdict}`);
  lines.push("- raw:");
  lines.push("```");
  lines.push(String(row.raw).replace(/\n$/, ""));
  lines.push("```");
  lines.push("");
}

function xmacCall(args, spyLog) {
  const before = spySize(spyLog);
  const result = run(["xmac.sh", ...args]);
  if (result.error) {
    throw new Error(`xmac.sh ${args.join(" ")} failed to spawn: ${result.error}`);
  }
  const recorded = spySlice(spyLog, before).replace(/\n$/, "");
  return { ...result, spy: recorded };
}

function inspect(argv) {
  const result = run(argv);
  if (result.error) {
    throw new Error(`${argv[0]} failed to spawn: ${result.error}`);
  }
  return result;
}

function gatherHost(name, paths) {
  const service = inspect([
    "awk",
    "-F|",
    "-v",
    `n=${name}`,
    "$1==n{print; exit}",
    paths.conf,
  ]);
  const serviceVerdict = service.stdout.trim() ? "VERIFIED" : "ABSENT";
  const status = xmacCall(["status", name], paths.spyLog);
  const leases = xmacCall(["leases"], paths.spyLog);
  const guard = inspect(["sed", "-n", "188,209p", paths.source]);
  const byLine = inspect(["grep", "-m", "1", " by=", paths.log]);
  const errLine = inspect(["grep", "-m", "1", " ERROR ", paths.log]);
  const flock = inspect(["grep", "-n", "-E", "flock|mutex|LOCKFILE", paths.source]);
  const dispatcher = inspect(["sed", "-n", "240,249p", paths.source]);
  const force = inspect(["sed", "-n", "142,172p", paths.source]);

  const argvRaw = [
    "status_spy:",
    status.spy || "(spy log did not grow)",
    "leases_spy:",
    leases.spy || "(spy log did not grow)",
  ].join("\n");
  const exitRaw = [
    `status_command=${status.command}`,
    `status_exit=${status.exit}`,
    `leases_command=${leases.command}`,
    `leases_exit=${leases.exit}`,
    "status_stdout:",
    body(status.stdout),
    "status_stderr:",
    body(status.stderr),
    "leases_stdout:",
    body(leases.stdout),
    "leases_stderr:",
    body(leases.stderr),
  ].join("\n");
  const stdioRaw = [
    `stdout_bytes=${Buffer.byteLength(status.stdout)}`,
    `stderr_bytes=${Buffer.byteLength(status.stderr)}`,
    "stdout:",
    body(status.stdout),
    "stderr:",
    body(status.stderr),
    `leases_stdout_bytes=${Buffer.byteLength(leases.stdout)}`,
    `leases_stderr_bytes=${Buffer.byteLength(leases.stderr)}`,
    "leases_stdout:",
    body(leases.stdout),
    "leases_stderr:",
    body(leases.stderr),
  ].join("\n");
  const logRaw = [
    `by_exit=${byLine.exit}`,
    "by_line:",
    body(byLine.stdout),
    `error_exit=${errLine.exit}`,
    "error_line:",
    body(errLine.stdout),
  ].join("\n");
  const concurrentRaw = [
    `grep_exit=${flock.exit}`,
    `stdout_bytes=${Buffer.byteLength(flock.stdout)}`,
    `stderr_bytes=${Buffer.byteLength(flock.stderr)}`,
    "stdout:",
    body(flock.stdout),
    "stderr:",
    body(flock.stderr),
    "dispatcher:",
    body(dispatcher.stdout),
  ].join("\n");

  return {
    name,
    claims: {
      "service-user permissions": claim(
        service.command,
        service.ts,
        service.exit,
        serviceVerdict,
        [`stdout_bytes=${Buffer.byteLength(service.stdout)}`, "stdout:", body(service.stdout), "stderr:", body(service.stderr)].join("\n"),
      ),
      "exact argv/subcommands": claim(
        `${status.command} ; ${leases.command}`,
        status.ts,
        status.exit,
        status.spy && leases.spy ? "VERIFIED" : "UNKNOWN",
        argvRaw,
      ),
      "exit codes": claim(
        `${status.command} ; ${leases.command}`,
        status.ts,
        status.exit,
        "VERIFIED",
        exitRaw,
      ),
      "stdout/stderr shape": claim(
        status.command,
        status.ts,
        status.exit,
        "VERIFIED",
        stdioRaw,
      ),
      "guard ordering": claim(
        guard.command,
        guard.ts,
        guard.exit,
        guard.stdout.includes("GUARD 1") && guard.stdout.includes("GUARD 3") ? "VERIFIED" : "UNKNOWN",
        [`stdout_bytes=${Buffer.byteLength(guard.stdout)}`, "stdout:", body(guard.stdout), "stderr:", body(guard.stderr)].join("\n"),
      ),
      "xmac log format": claim(
        `${byLine.command} ; ${errLine.command}`,
        byLine.ts,
        byLine.exit,
        byLine.stdout.trim() ? "VERIFIED" : "UNKNOWN",
        logRaw,
      ),
      "concurrent-call behavior": claim(
        flock.command,
        flock.ts,
        flock.exit,
        "UNKNOWN",
        concurrentRaw,
      ),
      "force semantics": claim(
        force.command,
        force.ts,
        force.exit,
        force.stdout.includes("--force") ? "VERIFIED" : "UNKNOWN",
        [`stdout_bytes=${Buffer.byteLength(force.stdout)}`, "stdout:", body(force.stdout), "stderr:", body(force.stderr)].join("\n"),
      ),
    },
  };
}

export function probePathsFromEnv() {
  const home = os.homedir();
  return {
    conf: process.env.XMAC_CONF || path.join(home, ".config/agent-protocols/xmac/machines.conf"),
    source: process.env.XMAC_SH_SOURCE || path.join(home, ".config/agent-protocols/lib/xmac.sh"),
    log: process.env.XMAC_LOG || path.join(home, ".xmac/xmac.log"),
    spyLog: process.env.XMAC_ARGV_SPY_LOG || "",
    out: process.env.XMAC_MATRIX_OUT || path.join("xmachines/projcore-run-2026-09-25/capability-matrix.md"),
  };
}

export function runProbe(paths) {
  const confText = fs.readFileSync(paths.conf, "utf8");
  const hosts = listHosts(confText);
  if (!hosts.length) throw new Error(`no hosts in ${paths.conf}`);
  const listed = inspect([
    "awk",
    "-F|",
    "!/^[[:space:]]*#/ && NF {print $1}",
    paths.conf,
  ]);
  const fromAwk = listed.stdout.split("\n").filter((line) => line.length > 0);
  if (fromAwk.join("\n") !== hosts.join("\n")) {
    throw new Error(`host list mismatch js=${hosts.join(",")} awk=${fromAwk.join(",")}`);
  }
  const generatedAt = utcNow();
  const gathered = hosts.map((name) => gatherHost(name, paths));
  const spyLogRaw = paths.spyLog && fs.existsSync(paths.spyLog) ? fs.readFileSync(paths.spyLog, "utf8") : "";
  if (paths.spyLog) {
    const gate = readOnlyViolation(spyLogRaw);
    if (!gate.ok) {
      throw new Error(`prohibited argv recorded: ${gate.offending}`);
    }
    if (!gate.records.length) {
      throw new Error("spy recorded no xmac argv");
    }
  }
  const matrix = buildMatrix({
    generatedAt,
    configured: claim(
      listed.command,
      listed.ts,
      listed.exit,
      listed.stdout.trim() ? "VERIFIED" : "ABSENT",
      [`stdout_bytes=${Buffer.byteLength(listed.stdout)}`, "stdout:", body(listed.stdout), "stderr:", body(listed.stderr)].join("\n"),
    ),
    hosts: gathered,
    spyLogRaw,
  });
  fs.mkdirSync(path.dirname(path.resolve(paths.out)), { recursive: true });
  fs.writeFileSync(paths.out, matrix);
  return { hosts, matrixPath: paths.out, spyLogRaw };
}

function main() {
  try {
    const result = runProbe(probePathsFromEnv());
    process.stdout.write(`wrote ${result.matrixPath} hosts=${result.hosts.join(",")}\n`);
  } catch (err) {
    process.stderr.write(`xmachines-contract-probe: ${err.message}\n`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
