# Run tests and handle failures

Run relevant tests and help fix any failures.

**Test Strategy:**
1. Run only tests relevant to current changes: `bunx vitest run path/to/relevant.test.ts`
2. Use sparingly: avoid running full test suite (`bun run test`) unless necessary
3. E2E tests (`bun run test:e2e`) require `bun run convex:dev` running separately

**Test Types:**

### Unit tests (Vitest)
- Test globals enabled — no need to import `describe`/`it`/`expect`
- Frontend tests use `jsdom`, Convex tests use `edge-runtime`
- Convex tests use `convex-test`: `const t = convexTest(schema);`
- Tests co-located with source: `manager.ts` -> `manager.test.ts`

### E2E tests (Playwright)
- Tests in `e2e/` directory, pattern `*.spec.ts`
- Use `waitForApp(page)` helper for hydration
- Only run if explicitly requested

**For Test Failures:**
1. Analyze failure output and root cause
2. Fix implementation or update tests as needed
3. Re-run tests to verify fixes

Please specify which tests to run or describe the test failures you're encountering.
