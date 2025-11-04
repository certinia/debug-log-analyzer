# Debug Log Analyzer Constitution

## Core Principles

### 1. Type Safety

Write all code in TypeScript with strict mode enabled (`strict: true` in tsconfig.json).

**Rules:**

- Avoid `any` types; use `unknown` or proper types with justification comments when unavoidable
- Public APIs require complete type definitions
- Type errors block builds

**Why:** Complex log data structures require strong typing to prevent runtime errors and enable better tooling.

### 2. Monorepo Modularity

Maintain clear separation between packages: `lana/` (VS Code extension), `log-viewer/` (webview), and `lana-docs-site/` (docs).

**Rules:**

- `log-viewer/` must not depend on VS Code APIs
- Cross-package imports use well-defined interfaces
- Each package has its own package.json

**Why:** Decoupling enables reuse and parallel development.

### 3. Performance

Handle large Salesforce debug logs (10MB+, 100k+ lines) efficiently without blocking the UI.

**Rules:**

- Visualizations render within 2 seconds for logs <5MB
- Operations >100ms show progress indicators
- No synchronous operations blocking extension host >50ms
- Profile and benchmark performance-critical paths

**Why:** Large logs are common in production debugging. Performance is a key differentiator.

### 4. User Experience

Build intuitive experiences for both novice and expert developers.

**Rules:**

- Major features accessible via Command Palette, context menus, and code lenses
- Interactive elements provide helpful tooltips
- Error messages are actionable with clear next steps
- Full keyboard navigation support for accessibility

**Why:** Discoverability and accessibility drive adoption across diverse user backgrounds.

### 5. Testing

Ensure reliability across VS Code versions and diverse Salesforce log formats.

**Rules:**

- New features and bug fixes include tests
- Tests run on CI and block failing merges
- Breaking changes to log parsing have test coverage for old and new formats

**Why:** Users rely on this for production debugging. Automated tests prevent regressions.

## Development Standards

### Code Quality

- Prettier and ESLint enforced via pre-commit hooks
- Use conventional commit messages
- Justify new dependencies; avoid duplication
- Code reviews check readability and functionality

### Releases

Follow Semantic Versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward-compatible)
- **PATCH**: Bug fixes, performance improvements

All releases include CHANGELOG updates. Breaking changes require migration guides.

---

**Version**: 2.0.0 | **Last Updated**: 2025-11-04
