#!/usr/bin/env node
// Test fixture: emits valid JSON to stdout and exits 0.
// Used by invokeJudgeWithFallback tests to simulate a working judge command.
process.stdout.write(JSON.stringify({ sessions: [{ id: "B1", status: "done", reason: "fixture" }] }));
