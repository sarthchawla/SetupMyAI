#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs-extra';
import { listPackages, getPackage } from '../lib/packages.js';
import { installPackage } from '../lib/installer.js';
import { mdToMdc, mdcToMd, mdFilenameToMdc, mdcFilenameToMd } from '../lib/converter.js';

const program = new Command();

program
  .name('setupmyai')
  .description('CLI for SetupMyAi -- install AI coding assistant packages')
  .version('0.1.0');

// ── init ────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Interactive mode: pick packages to install')
  .option('-t, --tool <tool>', 'Target tool: claude, cursor, or all', 'all')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .action(async (opts) => {
    const packages = listPackages();

    const { selected } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selected',
        message: 'Select packages to install:',
        choices: packages.map((pkg) => ({
          name: `${chalk.bold(pkg.key)} ${chalk.gray(`(tier ${pkg.tier})`)} - ${pkg.description}`,
          value: pkg.key,
          checked: pkg.tier === 1,
        })),
      },
    ]);

    if (selected.length === 0) {
      console.log(chalk.yellow('No packages selected.'));
      return;
    }

    const targetDir = path.resolve(opts.dir);
    console.log(chalk.blue(`\nInstalling ${selected.length} package(s) to ${targetDir}...\n`));

    for (const pkgName of selected) {
      try {
        const count = await installPackage(pkgName, targetDir, { tool: opts.tool });
        console.log(chalk.green(`  + ${pkgName}`) + chalk.gray(` (${count} items)`));
      } catch (err) {
        console.log(chalk.red(`  x ${pkgName}: ${err.message}`));
      }
    }

    console.log(chalk.green('\nDone!'));
  });

// ── install ─────────────────────────────────────────────────────────────────
program
  .command('install <packages...>')
  .description('Install specific packages (e.g., setupmyai install universal react-frontend)')
  .option('-t, --tool <tool>', 'Target tool: claude, cursor, or all', 'all')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .action(async (packages, opts) => {
    const targetDir = path.resolve(opts.dir);

    for (const pkgName of packages) {
      const pkg = getPackage(pkgName);
      if (!pkg) {
        console.log(chalk.red(`Unknown package: ${pkgName}`));
        console.log(chalk.gray(`Run "setupmyai list" to see available packages.`));
        continue;
      }

      try {
        const count = await installPackage(pkgName, targetDir, { tool: opts.tool });
        console.log(chalk.green(`  + ${pkgName}`) + chalk.gray(` (${count} items)`));
      } catch (err) {
        console.log(chalk.red(`  x ${pkgName}: ${err.message}`));
      }
    }
  });

// ── list ────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List available packages')
  .action(() => {
    const packages = listPackages();
    console.log(chalk.bold('\nAvailable packages:\n'));

    let currentTier = 0;
    for (const pkg of packages) {
      if (pkg.tier !== currentTier) {
        currentTier = pkg.tier;
        console.log(chalk.blue(`  Tier ${currentTier}:`));
      }
      console.log(`    ${chalk.green(pkg.key.padEnd(20))} ${pkg.description}`);
    }
    console.log('');
  });

// ── sync ────────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Re-sync installed packages to latest')
  .option('-t, --tool <tool>', 'Target tool: claude, cursor, or all', 'all')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .action(async (opts) => {
    const targetDir = path.resolve(opts.dir);
    const packages = listPackages();

    console.log(chalk.blue('Syncing all packages...\n'));

    for (const pkg of packages) {
      const pkgDir = path.resolve(
        new URL('../../packages', import.meta.url).pathname,
        pkg.key
      );
      if (!(await fs.pathExists(pkgDir))) continue;

      try {
        const count = await installPackage(pkg.key, targetDir, { tool: opts.tool });
        if (count > 0) {
          console.log(chalk.green(`  + ${pkg.key}`) + chalk.gray(` (${count} items)`));
        }
      } catch (err) {
        console.log(chalk.red(`  x ${pkg.key}: ${err.message}`));
      }
    }

    console.log(chalk.green('\nSync complete!'));
  });

// ── convert ─────────────────────────────────────────────────────────────────
program
  .command('convert')
  .description('Convert .md rules to .mdc (for Cursor) and vice versa')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .action(async (opts) => {
    const targetDir = path.resolve(opts.dir);
    let converted = 0;

    // .md -> .mdc: Claude rules -> Cursor rules
    const claudeRulesDir = path.join(targetDir, '.claude', 'rules');
    const cursorRulesDir = path.join(targetDir, '.cursor', 'rules');

    if (await fs.pathExists(claudeRulesDir)) {
      const mdFiles = (await fs.readdir(claudeRulesDir)).filter((f) => f.endsWith('.md'));
      if (mdFiles.length > 0) {
        await fs.ensureDir(cursorRulesDir);
        for (const file of mdFiles) {
          const content = await fs.readFile(path.join(claudeRulesDir, file), 'utf-8');
          const mdcContent = mdToMdc(content);
          const mdcFile = mdFilenameToMdc(file);
          await fs.writeFile(path.join(cursorRulesDir, mdcFile), mdcContent, 'utf-8');
          converted++;
        }
        console.log(chalk.green(`  Converted ${mdFiles.length} .md -> .mdc`));
      }
    }

    // .mdc -> .md: Cursor rules -> Claude rules
    if (await fs.pathExists(cursorRulesDir)) {
      const mdcFiles = (await fs.readdir(cursorRulesDir)).filter((f) => f.endsWith('.mdc'));
      if (mdcFiles.length > 0) {
        await fs.ensureDir(claudeRulesDir);
        for (const file of mdcFiles) {
          const content = await fs.readFile(path.join(cursorRulesDir, file), 'utf-8');
          const mdContent = mdcToMd(content);
          const mdFile = mdcFilenameToMd(file);
          const destPath = path.join(claudeRulesDir, mdFile);
          // Only write if the .md doesn't already exist (don't overwrite source of truth)
          if (!(await fs.pathExists(destPath))) {
            await fs.writeFile(destPath, mdContent, 'utf-8');
            converted++;
          }
        }
        console.log(chalk.green(`  Converted ${mdcFiles.length} .mdc -> .md (skipped existing)`));
      }
    }

    if (converted === 0) {
      console.log(chalk.yellow('No rules found to convert.'));
    } else {
      console.log(chalk.green(`\nConverted ${converted} file(s).`));
    }
  });

program.parse();
