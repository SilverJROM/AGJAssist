export interface AgentInfo {
  id: string;
  name: string;
  model: string;
  description: string;
}

const AGENTS: AgentInfo[] = [
  { id: "bsconsult", name: "StratForge Consultant", model: "Opus", description: "Business requirements & functional specs" },
  { id: "bsconsult02", name: "StratForge Lite", model: "Sonnet", description: "Business requirements (cost-optimized)" },
  { id: "sysarch", name: "ArchForge", model: "Opus", description: "Systems architecture design" },
  { id: "sysarch02", name: "ArchForge Lite", model: "Sonnet", description: "Systems architecture (cost-optimized)" },
  { id: "webdesign", name: "WebForge", model: "Opus", description: "UI/UX design" },
  { id: "webdesign02", name: "WebForge Lite", model: "Sonnet", description: "UI/UX design (cost-optimized)" },
  { id: "elitedev01", name: "EliteDev", model: "Opus", description: "Full-stack engineer" },
  { id: "elitedev02", name: "EliteDev Lite", model: "Sonnet", description: "Full-stack engineer (cost-optimized)" },
  { id: "pmanager", name: "Project Manager", model: "Opus", description: "Project management & orchestration" },
  { id: "pmanager02", name: "Project Manager Lite", model: "Sonnet", description: "Project management (cost-optimized)" },
  { id: "tester", name: "QA Tester", model: "Opus", description: "Playwright testing" },
  { id: "tester02", name: "QA Tester Lite", model: "Sonnet", description: "Playwright testing (cost-optimized)" },
  { id: "bugfix", name: "Bug Fix Pipeline", model: "Sonnet", description: "Bug diagnosis & fix" },
  { id: "migrator", name: "CF Deployer", model: "Opus", description: "Cloudflare deployment" },
  { id: "migrator02", name: "CF Deployer Lite", model: "Sonnet", description: "Cloudflare deployment (cost-optimized)" },
];

export function getAgentList(): AgentInfo[] {
  return AGENTS;
}
