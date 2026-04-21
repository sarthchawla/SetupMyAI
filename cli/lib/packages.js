export const SUPPORTED_TOOLS = ['claude', 'cursor', 'codex', 'opencode', 'gemini'];

export const PACKAGES = {
  universal: {
    name: '@setupmyai/universal',
    tier: 1,
    description: 'MR commands, CI fixes, worktree, statusline, hooks',
  },
  'react-frontend': {
    name: '@setupmyai/react-frontend',
    tier: 2,
    description: 'React/TS rules, frontend skills',
  },
  'kotlin-backend': {
    name: '@setupmyai/kotlin-backend',
    tier: 2,
    description: 'Kotlin/Ktor coding standards',
  },
  'bdd-testing': {
    name: '@setupmyai/bdd-testing',
    tier: 2,
    description: 'BDD workflow with Playwright',
  },
  'vercel-nextjs': {
    name: '@setupmyai/vercel-nextjs',
    tier: 2,
    description: 'Vercel deployment commands',
  },
  'auth-security': {
    name: '@setupmyai/auth-security',
    tier: 2,
    description: 'Auth & security best practices',
  },
  database: {
    name: '@setupmyai/database',
    tier: 2,
    description: 'PostgreSQL & migration skills',
  },
};

export function listPackages() {
  return Object.entries(PACKAGES)
    .sort((a, b) => a[1].tier - b[1].tier)
    .map(([key, pkg]) => ({ key, ...pkg }));
}

export function getPackage(name) {
  return PACKAGES[name] || null;
}
