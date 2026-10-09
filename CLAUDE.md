# quarterly-selection

Auditable, reproducible random selection of vehicles for quarterly inspection. Requirements and acceptance criteria are in `SPEC.md`.

## Rules
- Always use the ponytail skill (intensity level 'full') when writing code.
- Do not add obvious or unnecessary code comments. Comments should be 2-3 lines max.
- In the chat responses and interactions, be extremely concise. Sacrifice grammar for the sake of concision.
- Test-first: write a failing test for each acceptance criterion (name it with the AC ID), then the code.
- `npm test` must pass before any commit.

## Commands
- `npm install`
- `npm test`
- `npm run select -- ...` / `npm run verify -- ...` (usage in README)
