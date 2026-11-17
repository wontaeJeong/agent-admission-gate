# Scan Comparison Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task by task.

**Goal:** Improve comparison hierarchy, terminology and category navigation without changing mobile layout.

**Architecture:** Keep the existing comparison API and determine filtering from the complete bounded response in the React comparison component before pagination. Preserve limitations and metadata and use accessible native controls with bilingual text.

**Tech Stack:** React, TypeScript, Vite, Playwright, FastAPI.

**Spec:** `docs/superpowers/specs/2026-11-18-scan-comparison-design.md`.

## Global Constraints

Preserve authorization and verdict semantics; failed/cancelled scans show metadata only; no mobile layout redesign; use existing color tokens; do not run uploaded code.

## Review Focus

- Matching rows beyond page 1 remain reachable after filtering.
- Switching category resets pagination and exposes the selected state.
- Zero matching results have an honest empty state and all-category recovery.
- Comparison identity changes reset selection and never display stale evidence.
- Incomplete coverage, failed/cancelled scans and unlinked ZIP warnings remain intact in both languages.

### Task 1: Behavior and visual hierarchy

**Files:** Modify `frontend/src/pages/ScanCompare.tsx`, `frontend/src/styles.css`, `frontend/e2e/scan-compare.spec.ts`, `docs/src/content/docs/operations/requirements.md`.

- [ ] Add browser tests that first fail for summary order, classification selection, page reset, filtered count, zero results, bilingual explanations, failure and pair changes.
- [ ] Implement the approved layout, category controls and accurate contextual language with existing semantics and tokens.
- [ ] Run focused browser tests, full frontend build and tests, backend pytest and lint/format checks; document any failure and resolution in lessons learned.
- [ ] Inspect representative desktop dark/light and Korean states, capture synthetic-data evidence, and review diff and final verification.
