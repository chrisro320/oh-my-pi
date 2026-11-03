1. Implement the structured index validation in the existing extension; preserve reminder semantics.
2. Task builds the actual SDK/journal verifier without running it; main runs focused verification in a private HOME and network namespace. No live credentials/databases. Reviewer inspects correctness and security read-only.
3. Review with reviewer, resolve findings, record decisions and evidence, then mirror the extension for the next normal restart.
