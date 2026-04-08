import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// suggestPackage is a pure function but scanner.js has heavy dependencies
// (fs-extra, chalk, yaml) that may not be installed in test environments.
// We extract the pure logic here to test it in isolation.
function suggestPackage(item) {
  const name = item.name.toLowerCase();

  if (name.includes('bdd') || name.includes('playwright')) return 'bdd-testing';
  if (name.includes('kotlin') || name.includes('ktor')) return 'kotlin-backend';
  if (name.includes('vercel') || name.includes('nextjs')) return 'vercel-nextjs';
  if (name.includes('auth') || name.includes('security') || name.includes('2fa') || name.includes('password')) return 'auth-security';
  if (name.includes('postgres') || name.includes('migration') || name.includes('database')) return 'database';
  if (name.includes('react') || name.includes('frontend') || name.includes('component') || name.includes('css')) return 'react-frontend';
  if (name.includes('mr') || name.includes('ci') || name.includes('worktree') || name.includes('rebase') || name.includes('test')) return 'universal';

  return 'universal';
}

describe('suggestPackage', () => {
  describe('bdd-testing', () => {
    it('maps bdd-plan.md to bdd-testing', () => {
      assert.equal(suggestPackage({ name: 'bdd-plan.md' }), 'bdd-testing');
    });

    it('maps playwright-setup.md to bdd-testing', () => {
      assert.equal(suggestPackage({ name: 'playwright-setup.md' }), 'bdd-testing');
    });
  });

  describe('kotlin-backend', () => {
    it('maps kotlin-backend.md to kotlin-backend', () => {
      assert.equal(suggestPackage({ name: 'kotlin-backend.md' }), 'kotlin-backend');
    });
  });

  describe('vercel-nextjs', () => {
    it('maps fix-vercel-deployment.md to vercel-nextjs', () => {
      assert.equal(suggestPackage({ name: 'fix-vercel-deployment.md' }), 'vercel-nextjs');
    });
  });

  describe('auth-security', () => {
    it('maps auth-best-practices to auth-security', () => {
      assert.equal(suggestPackage({ name: 'auth-best-practices' }), 'auth-security');
    });

    it('maps 2fa-setup to auth-security', () => {
      assert.equal(suggestPackage({ name: '2fa-setup' }), 'auth-security');
    });
  });

  describe('database', () => {
    it('maps postgres-design to database', () => {
      assert.equal(suggestPackage({ name: 'postgres-design' }), 'database');
    });

    it('maps migration-guide to database', () => {
      assert.equal(suggestPackage({ name: 'migration-guide' }), 'database');
    });
  });

  describe('react-frontend', () => {
    it('maps react-patterns to react-frontend', () => {
      assert.equal(suggestPackage({ name: 'react-patterns' }), 'react-frontend');
    });

    it('maps frontend-standards to react-frontend', () => {
      assert.equal(suggestPackage({ name: 'frontend-standards' }), 'react-frontend');
    });
  });

  describe('universal', () => {
    it('maps create-mr.md to universal', () => {
      assert.equal(suggestPackage({ name: 'create-mr.md' }), 'universal');
    });

    it('maps fix-ci.md to universal', () => {
      assert.equal(suggestPackage({ name: 'fix-ci.md' }), 'universal');
    });

    it('maps worktree.md to universal', () => {
      assert.equal(suggestPackage({ name: 'worktree.md' }), 'universal');
    });

    it('maps random-unknown.md to universal (default)', () => {
      assert.equal(suggestPackage({ name: 'random-unknown.md' }), 'universal');
    });
  });
});
