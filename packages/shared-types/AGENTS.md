# packages/shared-types

Cross-language type definitions. TypeScript source → generated Python.

Root context: `/AGENTS.md`.

## Codegen Contract

`src/python_gen.ts` (run via `tsx`) reads TS type definitions and emits Python pydantic schemas to `apps/sidecar/src/audiomorph/schemas.py`.

```bash
pnpm --filter @audiomorph/shared-types gen:python
```

**Run after any change to shared types.** Forgetting → sidecar schemas drift from TS contracts → integration tests fail with cryptic validation errors.

## Workflow When Changing a Type

1. Edit TS source in `src/`.
2. `pnpm --filter @audiomorph/shared-types build` (emits TS declarations).
3. `pnpm --filter @audiomorph/shared-types gen:python` (regenerates sidecar schemas).
4. Run `pnpm test:sidecar-integration` to verify both sides agree.
5. Commit TS source + regenerated `schemas.py` together.

## Must Not

- DO NOT hand-edit `apps/sidecar/src/audiomorph/schemas.py`. It has a "DO NOT EDIT" header and CI regenerates on drift.
- DO NOT commit TS changes without regenerated Python output.
