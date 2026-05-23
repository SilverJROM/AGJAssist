#!/usr/bin/env node
// Test fixture: emits invalid JSON to stdout and exits 0.
// Used by invokeJudgeWithFallback tests to simulate a primary that produces unparseable output.
process.stdout.write("not-json");
