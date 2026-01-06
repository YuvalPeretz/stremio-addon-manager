# Development Guidelines

## 🔄 Meta Instruction

**CRITICAL: At the end of every interaction with the agent, the agent MUST review and update this guidelines.md file if needed to reflect new decisions, patterns, or architectural changes made during the session.**

**The agent MUST read and re-read these guidelines before every action to ensure consistency and adherence to project standards.**

---

## 📁 Project Structure & Component Organization

### Component File Structure

All components must follow this standardized structure:

```
componentName/
  ├── componentName.tsx          # Main component file
  ├── useComponentName.tsx       # Custom hook (conditional)
  └── componentName.module.scss  # Component styles (conditional)
```

**Rules:**

- **Main Component File**: Always required (`componentName.tsx`)
- **Custom Hook File**: Create `useComponentName.tsx` ONLY when the component has substantial state management logic that would clutter the main component file
- **Style Module**: Create `componentName.module.scss` ONLY when component-specific styling is needed beyond global config

---

## 🔧 State Management

### Local State

Use React's `useState` for simple component-local state management.

**Note**: Prefer Jotai atoms over `useReducer` for complex state logic. Do not use `useReducer` in this project.

### Global State (Jotai Atoms)

**Create Jotai atoms for any state that:**

- Needs to be shared across multiple components
- Represents application-level data (user session, cart, preferences, etc.)
- Should persist or be accessed globally

**Guideline**: If you find yourself prop-drilling through 2+ component levels, consider using a Jotai atom instead.

---

## 🎨 Styling Guidelines

### ⚠️ ABSOLUTE PROHIBITION

**YOU MAY NOT USE ANY TAILWINDCSS CLASSES OR CONFIGURATIONS UNDER ANY CIRCUMSTANCES**

### Styling Hierarchy (In Order of Priority)

Follow this strict order when styling components:

1. **Ant Design Config Provider** (First Priority)

   - Update the global `ConfigProvider` for theme tokens, component defaults, and global design system settings
   - Use for: colors, typography, spacing tokens, component default props

2. **Component-Specific SCSS Modules** (Second Priority)

   - Create `componentName.module.scss` for component-specific styles
   - Use CSS Modules to ensure style encapsulation
   - Use for: complex layouts, component-specific patterns, hover states, animations

3. **Inline Styling** (Last Resort)
   - Use inline styles ONLY for dynamic values or one-off adjustments
   - Use for: dynamic colors, calculated positions, conditional styles based on props

### Layout Components

**Prefer Ant Design's `Flex` component over plain `<div>` elements for layouts:**

- Use `<Flex>` from Ant Design for all layout containers and flex-based arrangements
- Leverage Flex component props: `justify`, `align`, `gap`, `vertical`, `wrap`, etc.
- Only use `<div>` when semantic HTML requires it or when Flex is not appropriate
- Avoid writing custom flexbox CSS when Ant Design's Flex component can handle it

**Benefits:**

- Consistent spacing using design system tokens
- Better readability and maintainability
- Built-in responsive behavior
- Less custom CSS to write and maintain

### Responsive Design

- **ALL components and layouts MUST be fully responsive and mobile-friendly**
- Test layouts on mobile, tablet, and desktop breakpoints
- Use relative units (`rem`, `em`, `%`, `vw`, `vh`) over fixed pixel values when appropriate
- Implement mobile-first design approach

### Design Aesthetic

- **Modern**: Clean, contemporary UI patterns
- **Simplistic**: Minimal clutter, focus on content and usability
- **Consistent**: Maintain design system consistency throughout the app

---

## 💻 Code Quality & Best Practices

### Component Design Principles

- **Single Responsibility**: Each component should do one thing well
- **Composition Over Inheritance**: Build complex UIs from small, reusable components
- **DRY (Don't Repeat Yourself)**: Extract common logic into hooks or utility functions
- **Proper Separation of Concerns**: Keep business logic separate from presentation

### Code Organization

- Break down large components into smaller, manageable pieces
- Extract complex logic into custom hooks
- Use TypeScript types and interfaces consistently
- Write self-documenting code with clear naming conventions

### Function & Variable Declaration Conventions

**Prefer `function` declarations for:**

- **React Components**: Use `function ComponentName()` for all React components
- **Regular Functions**: Use `function functionName()` for utility functions, helpers, and any reusable logic
- **Custom Hooks**: Use `function useHookName()` for custom React hooks

**Use `const` for:**

- **Constants**: Immutable values, configuration objects, and literal values
- **Arrow Functions**: When passing inline callbacks or when lexical `this` binding is needed
- **Variables**: Any variable that won't be reassigned

### Deprecation Management

**After every code change, actively check for and remove deprecated code:**

- **Unused Imports**: Remove any imports that are no longer used
- **Dead Code**: Delete commented-out code, unused functions, and unreachable code paths
- **Outdated Patterns**: Refactor old patterns to match current project standards
- **Deprecated Dependencies**: Check for deprecated package APIs and update to current versions
- **Orphaned Files**: Remove component files, hooks, or utilities that are no longer referenced
- **Console Logs**: Remove debug `console.log` statements from production code

**How to Check:**

1. Use TypeScript compiler warnings for unused imports/variables
2. Search for TODO/FIXME comments and address them
3. Review file structure for orphaned components
4. Verify all code paths are reachable and necessary

---

## 📦 Package Management

**⚠️ CRITICAL RULE: You MAY NOT install any npm packages without explicit user consent**

Before installing any package:

1. Ask the user for permission
2. Explain why the package is needed
3. Wait for approval before proceeding with installation

---

## 📝 Project Tracking

### Todo List Management

The project maintains a comprehensive `development/todo.md` file with checkable tasks:

- **Check off tasks** using markdown checkboxes `- [x]` as features are completed
- **Update progress** regularly to track development status
- **Add subtasks** under main items when breaking down complex features
- **Reference before starting work** to understand project scope and priorities
- **Update current sprint section** to show active work in progress

**Guidelines for Todo Updates:**

- Only mark tasks complete after thorough testing
- Add notes or blockers in the appropriate sections
- Break down large tasks into smaller, trackable items
- Keep the "Current Sprint" section up to date

---

## 📋 Development Workflow

1. **Read Guidelines**: Always review this document before starting work
2. **Plan Architecture**: Think through component structure and state management
3. **Implement**: Follow established patterns and best practices
4. **Review**: Ensure code meets all guidelines
5. **Check for Deprecated Code**: After making changes, scan the codebase for any deprecated patterns, unused imports, or outdated code. Remove or refactor deprecated code to use current best practices
6. **Update Guidelines**: If new patterns or decisions were made, update this document

---

## 🔄 Maintenance Reminder

**Remember**: This is a living document. Update it whenever:

- New architectural patterns are established
- Important technical decisions are made
- Common issues and their solutions are discovered
- Project requirements evolve

---

## 🎯 Project Overview

### Application Purpose

**Stremio Addon Manager** - An Electron desktop application providing a GUI for managing private Stremio addons with Real-Debrid integration. The application wraps the CLI functionality in a modern, user-friendly interface built with React and Ant Design.

**Core Goal:** Enable users to easily install, configure, and manage their Stremio addon on local or remote servers through an intuitive graphical interface, eliminating the need for command-line interaction.

---

## ✨ Core Features

### Installation

- Interactive installation wizard
- Local and remote (SSH) installation support
- Real-time progress tracking with visual feedback
- OS detection and automatic prerequisite installation
- SSL/HTTPS setup with Let's Encrypt

### Configuration Management

- Visual configuration editor
- Real-time validation
- Import/export configuration
- Provider management (Real-Debrid, AllDebrid, etc.)

### Service Control

- Start, stop, restart service controls
- Real-time service status monitoring
- Auto-start configuration
- Service health checks

### Monitoring & Logs

- Live log streaming
- Log filtering and search
- Service metrics and statistics
- System resource monitoring

### Dashboard

- At-a-glance addon status
- Quick actions and shortcuts
- Addon URL display with copy functionality
- Service health indicators

---

## 📅 Project Status

**Current Phase:** Phase 1 - Structure and Foundation Complete

**Completed:**

- ✅ Electron + React + TypeScript setup
- ✅ Ant Design integration with dark theme
- ✅ Jotai state management atoms
- ✅ Main process with IPC handlers
- ✅ Preload script for secure communication
- ✅ Basic routing and layout structure
- ✅ Dashboard page with service status
- ✅ SCSS module styling system

**In Progress:**

- 🔄 Installation wizard UI
- 🔄 Configuration management interface
- 🔄 Service control interface
- 🔄 Log viewer component

**Next:**

- 📅 Complete all page implementations
- 📅 Add comprehensive error handling
- 📅 Implement real-time updates
- 📅 Add unit tests
- 📅 Create production builds

---

_Last Updated: January 6, 2026 - Phase 1 Foundation Complete_
