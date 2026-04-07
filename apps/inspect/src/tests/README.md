# Testing Structure

This directory contains the test files for the application. The test framework is built using Vitest and TypeScript.

## Directory Structure

- `tests/`: Root directory for all tests
    - `setupTests.ts`: Setup file for Vitest tests

## Running Tests

To run the tests, use the following commands:

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage
```

## Test Philosophy

Tests are designed to verify functionality rather than implementation details. This means:

- Tests should not break due to minor changes in HTML structure
- Tests focus on the behavior of functions and components
- Tests should be fast and reliable

## Adding Tests

When adding new tests:

1. Create a new test file with the `.test.ts` or `.test.tsx` extension
2. Import the functions or components you want to test
3. Write tests that verify behavior without making assumptions about implementation
4. Use descriptive test names to make it clear what's being tested

## Mocking

For mocking external services or components:

1. Mock only what's necessary for the test
2. Use Vitest's mocking capabilities (`vi.fn()`, `vi.mock()`) to replace dependencies
