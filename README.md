# Twelve Factor Reseach Assistant Agent 🤖🔍

Showcase project demonstrating a **Deep Agent** built according to the **12-Factor Agent principles**.

This repository is part of an advanced AI engineering training program.
Its purpose is to showcase **architecture, control flow, and state management** for deep agents following the 12-Factor model.

---

## Background

This project was created during a professional AI developer training focused on building production-grade agent systems.

The architectural foundation is the **12-Factor Agent model**:
https://github.com/humanlayer/12-factor-agents

The goal is not feature completeness, but a **clear, explainable, and inspectable** agent architecture.

---

## Features (Current State)

- Multi-agent architecture
- Supervisor-driven orchestration
- Specialized sub-agents (Researcher, Writer)
- Explicit tool abstraction
- Centralized LLM factory
- Stateless reducer-based state management
- CLI-based execution entrypoint

The project is still under active development. Missing capabilities are documented explicitly below.

---

## 12-Factor Agent Implementation

### 1. Natural Language → Tool Calls
**Status:** In progress 🔧

Toll calls are only simulated at the moment

---

### 2. Own Your Prompts
**Status:** Implemented (basic) ✅

Prompts are explicitly defined in code and not hidden behind framework defaults.

---

### 3. Own Your Context`
**Status:** Not implemented yet ❌

Context window composition and summarization are not yet explicitly managed.

---

### 4. Tools Are Functions
**Status:** In progress 🔧

Toll calls are only simulated at the moment
All tools are planned to be Zod validated functions with explicit inputs and outputs.

---

### 5. Unified Memory
**Status:** Not implemented yet ❌

There is no persistent or shared memory layer at this stage.

---

### 6. Checkpointing
**Status:** Not implemented yet ❌

Execution state is not yet serializable for resume or replay.

---

### 7. Humans as Tools
**Status:** Not implemented yet ❌

No explicit human-in-the-loop tools are present yet.

---

### 8. Own Control Flow ✅
**Status:** Implemented

Control flow is explicitly coded and not delegated to a framework.

```ts
await runAgentLoop(initialState, agentReducer)
```

---

### 9. Error Compaction 
**Status:** Implemented (basic) ✅

Errors from model output parsing/validation are compacted into a short retry instruction and stored in state/history
The task is reset to pending for retry.

---

### 10. Small, Specialized Agents ✅
**Status:** Implemented

The system consists of:
- Supervisor agent
- Researcher sub-agent
- Writer sub-agent

Each agent has a clearly scoped responsibility.

---

### 11. Trigger Anywhere
**Status:** Partially implemented ❌

The agent is currently triggered via CLI.


---

### 12. Stateless Reducer
**Status:** Implemented (core) ✅

All state transitions are handled through a pure reducer function.
The reducer is pure and side-effect free.
Persistence and replay are planned but not yet implemented.

---

## Dependencies

- **bun** — runtime, package manager, and task runner

---

## Setup

### Install dependencies

```bash
bun install
```

### Run demo

```bash
bun run src/index.ts
```

---

## Project Structure

```text
src/
├── agents/
│   └── sub-agents/
│       ├── researcher.ts
│       └── writer.ts
├── tools/
│   └── planningtool.ts
├── llm.ts
└── index.ts
```
### Output Formatting

The file `display_output.ts` contains helper functions used **only for CLI output formatting**.
It transforms the internal agent state into a more readable console representation without modifying or affecting the actual agent state or logic.

---

## Project Status

This repository represents an early but architecturally correct implementation.

The focus is on:
- explicit state transitions
- deterministic control flow
- clear separation of responsibilities

Missing features are intentionally documented and will be added incrementally.
