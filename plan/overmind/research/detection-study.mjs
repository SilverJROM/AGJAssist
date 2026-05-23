import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
const wm = await import('/home/agjrom/TGBOTS/AGJAssist/dist/services/overmind-watcher.js');
const norm = wm.normalizePaneForActivity || ((x) => x);
const D = (await import('/home/agjrom/TGBOTS/AGJAssist/node_modules/better-sqlite3/lib/index.js')).default;

const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BASE = '/home/agjrom/TGBOTS/AGJAssist/plan/overmind/research';
const LOG = `${BASE}/detection-study-${TS}.jsonl`;
const READ = `${BASE}/detection-study-${TS}.log`;
const DB = '/home/agjrom/TGBOTS/AGJAssist/data/agjassist.db';
const WF = [
  { label: 'HRIS', parent: 'hris-d-22', child: 'hrcdx' },
  { label: 'lkcamp', parent: 'lkcamp-12', child: 'bcui' },
  { label: 'overmind-ovm', parent: 'AGJ-51', child: 'ovm-build5' },
];
const SAMPLES = 18, INTERVAL_MS = 180000;
const h = (s) => crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 10);
const cap = (t) => { try { return execFileSync('tmux', ['capture-pane', '-p', '-t', t], { encoding: 'utf8' }).split('\n').slice(-45).join('\n'); } catch { return '<<no session>>'; } };
const PROMPT = (wf, prevP, curP, prevC, curC) =>
  `Judge if two tmux sessions are ACTIVELY WORKING vs IDLE/waiting/stuck. PARENT = Claude Code coordinator; CHILD = codex CLI. You get PREVIOUS (~3min ago) + CURRENT snapshots. RULE: a spinner whose only delta is a ticking timer ("(11m 13s)"->"(11m 16s)") or rotating glyph is NOT progress = waiting/idle. Real work = substantive new content. Empty composer + no active spinner = idle.\nReply ONLY JSON: {"parent":{"state":"working|idle|waiting|stuck","reason":"<=10 words"},"child":{"state":"working|idle|waiting|stuck","reason":"<=10 words"}}\n[PARENT ${wf.parent} PREV]\n${prevP}\n[PARENT CURRENT]\n${curP}\n[CHILD ${wf.child} PREV]\n${prevC}\n[CHILD CURRENT]\n${curC}`;
const brain = (cmd, args, p) => { try { const o = execFileSync(cmd, args.concat(p), { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] }); const m = o.match(/\{[\s\S]*\}/); return m ? m[0] : o.slice(-200); } catch (e) { return 'ERR:' + (e.message || '').slice(0, 60); } };
const spark = (p) => brain('codex', ['exec', '--model', 'gpt-5.3-codex', '--skip-git-repo-check'], p);
const sonnet = (p) => brain('claude', ['-p', '--dangerously-skip-permissions', '--model', 'sonnet'], p);

const prev = {};
for (let s = 1; s <= SAMPLES; s++) {
  const at = new Date().toISOString().slice(11, 19);
  for (const wf of WF) {
    const curP = cap(wf.parent), curC = cap(wf.child);
    const pr = prev[wf.label] || { p: '<<first>>', c: '<<first>>' };
    const pRaw = h(curP) !== h(pr.p), pNorm = h(norm(curP)) !== h(norm(pr.p));
    const cRaw = h(curC) !== h(pr.c), cNorm = h(norm(curC)) !== h(norm(pr.c));
    const sp = s === 1 ? 'skip' : spark(PROMPT(wf, pr.p, curP, pr.c, curC));
    const so = s === 1 ? 'skip' : sonnet(PROMPT(wf, pr.p, curP, pr.c, curC));
    let row = null; try { const db = new D(DB); row = db.prepare('SELECT status,parent_status,child_statuses FROM overmind_workflows WHERE coordinator_session=?').get(wf.parent); db.close(); } catch {}
    const rec = { sample: s, at, wf: wf.label, parent_change: { raw: pRaw, norm: pNorm }, child_change: { raw: cRaw, norm: cNorm }, overmind: row, spark: sp, sonnet: so };
    fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
    fs.appendFileSync(READ, `\n#${s} ${at} ${wf.label} | parent raw=${pRaw} norm=${pNorm} | child raw=${cRaw} norm=${cNorm}\n  overmind: ${JSON.stringify(row)}\n  SPARK : ${sp}\n  SONNET: ${so}\n`);
    prev[wf.label] = { p: curP, c: curC };
  }
  if (s < SAMPLES) await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
fs.appendFileSync(READ, '\n=== STUDY COMPLETE ===\n');
