# Agent Note: Retain unusable Messages tool arguments for the tool runtime

Status: implemented

English | [中文](2026-10-11-messages-unusable-tool-arguments.zh.md)

## Problem

DeepSeek Messages streams a tool call whose arguments are unusable JSON while still reporting `stop_reason: tool_use`. A long nested GenUI spec is where it happens: one extra closing bracket, or a premature `}` followed by more properties. The [translator](../../../../packages/llm/llm-deepseek/src/protocols/messages/translate.ts) parsed the accumulated `input_json_delta` at `message_stop` and failed the attempt with `MALFORMED_RESPONSE`, which the default retry policy does not retry, so the turn ended and everything the model had produced in that turn was discarded.

## Decision

The translator retains the accumulated tool arguments verbatim and finishes with `tool-calls`, matching Chat Completions, which never validated them. The [agent loop](../../../../packages/core/agent-loop/src/tool-calls.ts) already preserves invalid JSON as text, so the tool runtime rejects the call as `INVALID_ARGS` and the model corrects itself within the same turn. Provider-side protocol faults still fail: a non-object `content_block.input`, an unknown delta type, or a delta without an open block is a malformed payload, not a model mistake. Output-limit truncation keeps its existing pruning in the [shared assembler](../../../../packages/llm/llm/src/assembler.ts).

This supersedes the response-side validation in the [historical tool input note](2026-09-16-messages-historical-tool-input.md). The request-side fallback is unchanged and now covers exactly what the response side retains: the durable Assistant block keeps the original text, and the next Messages request sends `{}` as that call's input. No Session event, persistence type, or protocol configuration changes.

## Alternatives considered

**Keep failing the attempt.** The failure is not retryable, it hides the model's own mistake from the model, and it costs the turn.

**Repair the JSON.** Guessing a missing or extra bracket can change the requested operation — the same reason the [historical note](2026-09-16-messages-historical-tool-input.md) refuses to repair request input.

**Add `MALFORMED_RESPONSE` to the retryable codes.** Re-sampling a content-level fault discards the turn's reasoning and can reproduce it; the model has the exact violation available instead.

## Consequences

A malformed tool call costs one tool error and one model step instead of the turn. The model sees `INVALID_ARGS` with the schema violations and the arguments it actually sent, and the Session log keeps that text. The tool never runs with guessed arguments.

Verification covers the translation unit cases (stray closing bracket, truncated object, non-object JSON: retained verbatim with a `tool-calls` finish) and a composition test that loads the plugin through the Loader, the agent loop, and the real tool runtime, scripts a malformed `input_json_delta` stream, and asserts the turn completes with an `isError` result carrying `INVALID_ARGS` while the next request sends `input: {}` for that call. No keyless session scenario is added: `dsh-llm-replay` supplies the model script from the recorded transcript, so a snapshot cannot reach response translation. The recovered transcript this decision makes reachable is already recorded by the [invalid-tool-history scenario](../../../../snapshots/session/deepseek-messages-invalid-tool-history/snapshot.yml), where the tool rejects the malformed arguments and the turn completes.
