import fs from "node:fs";
import path from "node:path";
import type { OvermindService, OvermindTask, OvermindWorkflow } from "../src/services/overmind-service.js";

interface AttachedWorkflowFixtureInput {
  label: string;
  coordinator_session: string;
  child_sessions?: string[];
  child_roles?: string[];
  run_dir: string;
  current_task?: string | null;
  tasks?: OvermindTask[];
}

interface FixtureState {
  seq: number;
  runDirCounts: Map<string, number>;
}

const states = new WeakMap<OvermindService, FixtureState>();

function fixtureState(service: OvermindService): FixtureState {
  let state = states.get(service);
  if (!state) {
    state = { seq: 0, runDirCounts: new Map() };
    states.set(service, state);
  }
  return state;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workflow";
}

export function registerAttachedWorkflowFixture(
  service: OvermindService,
  input: AttachedWorkflowFixtureInput
): OvermindWorkflow {
  const state = fixtureState(service);
  const priorCount = state.runDirCounts.get(input.run_dir) ?? 0;
  state.runDirCounts.set(input.run_dir, priorCount + 1);
  state.seq += 1;

  const runDir = priorCount === 0
    ? input.run_dir
    : path.join(input.run_dir, `.attached-fixture-${priorCount + 1}-${safeSlug(input.coordinator_session)}`);
  fs.mkdirSync(runDir, { recursive: true });

  const project = service.createProject({
    slug: `fixture-${state.seq}-${safeSlug(input.coordinator_session)}`,
    app_path: runDir,
    parent_session: input.coordinator_session,
    notes: null
  });
  const workflow = service.registerAttached({
    project_id: project.id,
    label: input.label,
    run_dir: runDir,
    coordinator_session: input.coordinator_session,
    current_task: input.current_task,
    tasks: input.tasks
  });

  if (input.child_sessions || input.child_roles) {
    return service.setChildren(
      workflow.id,
      input.child_sessions ?? [],
      input.child_roles ?? input.child_sessions?.map(() => "child") ?? []
    ) ?? workflow;
  }
  return workflow;
}
