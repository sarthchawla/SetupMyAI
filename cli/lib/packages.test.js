import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PACKAGES, listPackages, getPackage } from './packages.js';

describe('packages', () => {
  describe('listPackages', () => {
    it('returns all 8 packages', () => {
      const packages = listPackages();
      assert.equal(packages.length, 8);
    });

    it('returns packages sorted by tier (tier 1 first, then 2, then 3)', () => {
      const packages = listPackages();
      const tiers = packages.map((p) => p.tier);
      for (let i = 1; i < tiers.length; i++) {
        assert.ok(tiers[i] >= tiers[i - 1], `tier at index ${i} (${tiers[i]}) should be >= tier at index ${i - 1} (${tiers[i - 1]})`);
      }
      assert.equal(tiers[0], 1);
      assert.equal(tiers[tiers.length - 1], 3);
    });
  });

  describe('getPackage', () => {
    it('returns correct object for universal', () => {
      const pkg = getPackage('universal');
      assert.equal(pkg.name, '@setupmyai/universal');
      assert.equal(pkg.tier, 1);
      assert.ok(pkg.description.length > 0);
    });

    it('returns null for nonexistent package', () => {
      assert.equal(getPackage('nonexistent'), null);
    });
  });

  describe('PACKAGES structure', () => {
    it('every package has name, tier, and description fields', () => {
      for (const [key, pkg] of Object.entries(PACKAGES)) {
        assert.ok(typeof pkg.name === 'string', `${key} should have a string name`);
        assert.ok(typeof pkg.tier === 'number', `${key} should have a number tier`);
        assert.ok(typeof pkg.description === 'string', `${key} should have a string description`);
      }
    });
  });
});
