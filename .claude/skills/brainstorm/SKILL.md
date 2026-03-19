---
name: brainstorm
description: Design gate before implementation — explore approaches and trade-offs before writing code
user-invocable: true
---

# Brainstorm

Design gate before implementation. Use when a feature is architecturally complex — new data models, new system boundaries, or multiple valid approaches.

## Usage

/brainstorm <description of what to build>

## Process

### 1. Understand

Restate the problem in your own words. Identify:
- What exactly needs to happen (functional requirements)
- What's ambiguous or underspecified
- What constraints exist (existing patterns, performance, backwards compatibility)

If something is genuinely unclear, ask **one** clarifying question. Wait for the answer before proceeding. Do not ask a wall of questions — one at a time.

### 2. Research

Spawn the `researcher` agent to explore the codebase:
- Existing patterns that this feature should follow or extend
- Related features that solve similar problems
- Constraints from the schema, API surface, or frontend state model
- Files that will need to change

### 3. Design

Present **1-3 approaches** with trade-offs. For each approach:

- **Files to modify** — which files change and roughly how
- **Data model changes** — new tables, fields, indexes (if any)
- **Key code shapes** — pseudocode or interface sketches showing the approach, not full implementations
- **Risks** — what could go wrong, what's hard, what's uncertain
- **Trade-offs** — what you gain vs what you give up compared to the other approaches

**Recommend one** with a clear reason. Prefer the simplest approach that meets the requirements (KISS).

### 4. Gate

Wait for explicit user approval before proceeding. Present the options clearly and ask:

> Which approach would you like to go with? Or would you like to explore a different direction?

After approval, offer to hand off to:
- `/autopilot` for single-agent implementation
- `/autopilot-team` for parallel team implementation
- Or let the user implement manually with the design as a guide

## When to Use

**Use `/brainstorm` when:**
- New data model or schema changes with multiple valid approaches
- New system boundary (API endpoint, WebSocket message type, external integration)
- Feature description is ambiguous or underspecified
- Multiple architectural approaches exist with meaningful trade-offs

**Skip and implement directly when:**
- The approach is obvious from existing patterns
- The user has given specific, detailed instructions
- It's a bug fix, refactor, or enhancement to existing behavior
