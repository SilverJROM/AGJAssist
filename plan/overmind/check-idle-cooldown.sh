#!/usr/bin/env bash
# Usage: bash plan/overmind/check-idle-cooldown.sh [workflow_id]
# Shows when the last idle-nudge fired per workflow and how long until cooldown expires.
node -e "
const fs=require('fs');const D=require('better-sqlite3');
const settings=JSON.parse(fs.readFileSync('data/app-settings.json','utf8'));
const cooldownMin=settings.overmind?.idle_nudge_cooldown_minutes ?? 20;
const cooldownMs=cooldownMin*60_000;
let state={workflows:{}};
try{state=JSON.parse(fs.readFileSync('data/overmind-cooldown-state.json','utf8'));}catch{}
const db=new D('data/agjassist.db');
const arg='$1';
const rows=db.prepare(arg?\"SELECT id,coordinator_session,display_name,label,status FROM overmind_workflows WHERE id=?\":\"SELECT id,coordinator_session,display_name,label,status FROM overmind_workflows WHERE status NOT IN ('completed','failed','paused')\").all(...(arg?[Number(arg)]:[]));
db.close();
const now=Date.now();
console.log('cooldown:',cooldownMin,'min ('+cooldownMs+'ms)');
for(const r of rows){
  const last=state.workflows?.[String(r.id)]?.lastIdleNudgeAt ?? 0;
  const sinceMin=last?((now-last)/60_000).toFixed(1):'—';
  const remMin=last?Math.max(0,(cooldownMs-(now-last))/60_000).toFixed(1):'—';
  console.log(\`#\${r.id} \${(r.display_name||r.label||'').slice(0,30)} (\${r.coordinator_session}) [\${r.status}] -- last nudge \${sinceMin}min ago, cooldown remaining \${remMin}min\`);
}
"
