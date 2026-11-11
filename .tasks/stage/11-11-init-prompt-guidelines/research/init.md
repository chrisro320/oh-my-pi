---
name: init
description: Generate AGENTS.md for current codebase
thinking-level: medium
---

Use parallel `task` research agents: core src, tests, configs/build, scripts/docs; synthesize findings into one AGENTS.md.

<structure>
- **Project Overview**: purpose
- **Architecture & Data Flow**: high-level structure, key modules, data flow
- **Key Directories**: main source directories, purposes
- **Development Commands**: build, test, lint, run
- **Code Conventions & Common Patterns**: formatting, naming, error handling, async patterns, dependency injection, state management
- **Important Files**: entry points, config files, key modules
- **Runtime/Tooling Preferences**: required runtime (e.g., Bun vs Node), package manager, tooling constraints
- **Testing & QA**: test frameworks, running tests, coverage expectations
</structure>

<directives>
- MUST title document "Repository Guidelines"; one `##` heading per structure item; write in English
- MUST concise and practical: only what an AI assistant needs and cannot infer from code structure; give concrete commands, paths, naming patterns
- MUST accurate: trace every command, path, and claim to files read or commands run; state an absence where an assistant would otherwise guess (e.g., no lint script); NEVER invent
- MUST state each fact once; NEVER restate across sections
- MUST describe current state only: replace outdated content in place; omit retired or reference-only workflows, tools, and directories; NEVER keep superseded/formerly/replaced-by notes, dates, or history
- NEVER duplicate DECISIONS.md or .tasks/lessons.md: when present, link by path; NEVER copy or paraphrase their choices, rationale, or pitfalls, including as architecture description
</directives>

<output>
After analysis: MUST write AGENTS.md to project root; existing file: rewrite to current state, keeping only still-accurate content.
</output>
