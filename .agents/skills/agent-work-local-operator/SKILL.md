---
name: agent-work-local-operator
description: Run the fixed local-only Agent Work Ledger Phase 2 operator wrapper and require exact manifest evidence.
---
# Agent Work Local Operator

## Purpose

Use this skill when the task is to run or verify the fixed local Agent Work Ledger operator profile.

The operator is an engineering harness only:

- no arguments
- no caller-selected workflow, tenant, mode, URL, or credential
- no `.env*` reads
- no hosted, provider, or deployment action

## Contract

- entrypoint: `scripts/agent-work-ledger-local-operator.mjs`
- harness source: `scripts/agent-work-ledger-harness/phase2Harness.mjs`
- argv source: `process.argv.slice(2)`
- main guard: `pathToFileURL(...)`

## Required Behavior

Before execution:

- reject any argv with `operator_arguments_forbidden`

After execution:

- require the exact current `PHASE2_CHECKS` ids
- require every check to be `passed`
- require every `sanitizedOutputSha256` to be a 64-character hex digest
- require `cleanup.status`, `databaseAudit`, `composeDown`, `supabaseStop`, `composeResidue`, `networkResidue`, and `archiveContext` to be `passed`
- require `exitStatus=passed` and `exitCode=0`
- require `summaryLogSha256` and `checkEvidenceSha256` to be 64-character hex digests

Failure output must be a lowercase underscore machine-safe code only.
