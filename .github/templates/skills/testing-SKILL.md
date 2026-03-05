# Testing

## When to Test
- Write tests for core business logic
- Write tests for edge cases and error handling
- Skip tests for trivial UI-only code in MVP

## How to Test
- Use the testing framework appropriate for the tech stack
- Tests should be runnable with a single command
- Document the test command in README.md

## Validation
- Before creating a PR, verify the app works:
  - Open index.html in a browser (for web apps)
  - Run the CLI tool with sample input (for CLI tools)
  - Run the test suite if one exists
