#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { listPackages, getPackage, SUPPORTED_TOOLS } from '../lib/packages.js';
import { installPackage } from '../lib/installer.js';
import { mdToMdc, mdcToMd, mdFilenameToMdc, mdcFilenameToMd } from '../lib/converter.js';
import { getInventory, summarizeInstalled, updateInventory } from '../lib/inventory.js';
import { getCliUpdateStatus, resolveSelfUpdateCommand, runSelfUpdate } from '../lib/self-update.js';

const program = new Command();
const packageJson = fs.readJsonSync(fileURLToPath(new URL('../../package.json', import.meta.url)));

program
  .name('setupmyai')
  .description('CLI for SetupMyAi -- install AI coding assistant packages')
  .version(packageJson.version);

// ── init ────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Interactive mode: pick packages and tools to install')
  .option('-t, --tool <tools>', 'Target tools (comma-separated): claude,cursor,codex,opencode,gemini or all', 'all')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .option('-l, --level <level>', 'Install level: user or project', 'project')
  .action(async (opts) => {
    const packages = listPackages();

    const { selectedTools } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedTools',
        message: 'Select AI tools to install for:',
        choices: SUPPORTED_TOOLS.map((tool) => ({
          name: tool.charAt(0).toUpperCase() + tool.slice(1),
          value: tool,
          checked: opts.tool === 'all' || opts.tool.split(',').includes(tool),
        })),
        validate: (answer) => answer.length > 0 ? true : 'Select at least one tool.',
      },
    ]);

    const { level } = await inquirer.prompt([
      {
        type: 'list',
        name: 'level',
        message: 'Install level:',
        choices: [
          { name: 'Project (current directory)', value: 'project' },
          { name: 'User (home directory, applies to all projects)', value: 'user' },
        ],
        default: opts.level,
      },
    ]);

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
    const toolLabel = selectedTools.join(', ');
    const levelLabel = level === 'user' ? '~/ (user-level)' : targetDir;
    console.log(chalk.blue(`\nInstalling ${selected.length} package(s) for [${toolLabel}] to ${levelLabel}...\n`));

    for (const pkgName of selected) {
      try {
        const count = await installPackage(pkgName, targetDir, {
          tool: selectedTools,
          level,
        });
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
  .option('-t, --tool <tools>', 'Target tools (comma-separated): claude,cursor,codex,opencode,gemini or all', 'all')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .option('-l, --level <level>', 'Install level: user or project', 'project')
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
        const count = await installPackage(pkgName, targetDir, {
          tool: opts.tool,
          level: opts.level,
        });
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
  .option('--installed', 'Show installed packages instead of available packages')
  .option('-t, --tool <tools>', 'Target tools (comma-separated): claude,cursor,codex,opencode,gemini or all', 'all')
  .option('-p, --package <packages>', 'Installed package keys (comma-separated)')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .option('-l, --level <level>', 'Install level: user, project, or all', 'project')
  .option('--json', 'Print JSON output')
  .action(async (opts) => {
    if (opts.installed) {
      const targetDir = path.resolve(opts.dir);
      const inventory = await getInventory(targetDir, {
        tool: opts.tool,
        package: opts.package,
        level: opts.level,
        includeUnmanaged: false,
      });
      const installed = summarizeInstalled(inventory);

      if (opts.json) {
        console.log(JSON.stringify(installed, null, 2));
        return;
      }

      console.log(chalk.bold('\nInstalled packages:\n'));
      if (installed.length === 0) {
        console.log(chalk.yellow('  No SetupMyAi-managed packages found.\n'));
        return;
      }

      for (const pkg of installed) {
        const statuses = Object.entries(pkg.statuses)
          .map(([status, count]) => `${status}:${count}`)
          .join(', ');
        console.log(`  ${chalk.green(pkg.packageKey.padEnd(20))} ${chalk.gray(`${pkg.level}/${pkg.tool}`)} ${statuses}`);
      }
      console.log('');
      return;
    }

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

    console.log(chalk.bold('\nSupported tools:'));
    console.log(`    ${SUPPORTED_TOOLS.join(', ')}\n`);
  });

// ── status ─────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show installed SetupMyAi inventory and drift status')
  .option('-t, --tool <tools>', 'Target tools (comma-separated): claude,cursor,codex,opencode,gemini or all', 'all')
  .option('-p, --package <packages>', 'Installed package keys (comma-separated)')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .option('-l, --level <level>', 'Install level: user, project, or all', 'all')
  .option('--json', 'Print JSON output')
  .action(async (opts) => {
    const targetDir = path.resolve(opts.dir);
    const inventory = await getInventory(targetDir, {
      tool: opts.tool,
      package: opts.package,
      level: opts.level,
    });
    const cli = await getCliUpdateStatus();

    if (opts.json) {
      console.log(JSON.stringify({ ...inventory, cli }, null, 2));
      return;
    }

    printInventory(inventory, cli);
  });

// ── sync ────────────────────────────────────────────────────────────────────
program
  .command('update')
  .description('Update installed SetupMyAi-managed files to current package content')
  .option('-t, --tool <tools>', 'Target tools (comma-separated): claude,cursor,codex,opencode,gemini or all', 'all')
  .option('-p, --package <packages>', 'Installed package keys (comma-separated)')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .option('-l, --level <level>', 'Install level: user, project, or all', 'all')
  .option('--check', 'Exit non-zero if updates are needed')
  .option('--dry-run', 'Show what would update without writing changes')
  .option('--force', 'Overwrite locally modified managed files')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--json', 'Print JSON output')
  .action(async (opts) => {
    await runManagedUpdate(opts);
  });

program
  .command('sync')
  .description('Alias for update')
  .option('-t, --tool <tools>', 'Target tools (comma-separated): claude,cursor,codex,opencode,gemini or all', 'all')
  .option('-p, --package <packages>', 'Installed package keys (comma-separated)')
  .option('-d, --dir <dir>', 'Target project directory', process.cwd())
  .option('-l, --level <level>', 'Install level: user, project, or all', 'all')
  .option('--check', 'Exit non-zero if updates are needed')
  .option('--dry-run', 'Show what would update without writing changes')
  .option('--force', 'Overwrite locally modified managed files')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--json', 'Print JSON output')
  .action(async (opts) => {
    await runManagedUpdate(opts, { syncAlias: true });
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

async function runManagedUpdate(opts, { syncAlias = false } = {}) {
  const targetDir = path.resolve(opts.dir);
  const cliStatus = await getCliUpdateStatus();
  const result = await updateInventory(targetDir, {
    tool: opts.tool,
    package: opts.package,
    level: opts.level,
    dryRun: Boolean(opts.dryRun || opts.check),
    force: opts.force,
  });

  if (opts.json) {
    console.log(JSON.stringify({ ...result, cli: cliStatus }, null, 2));
  } else {
    if (syncAlias) {
      console.log(chalk.gray('sync is an alias for update.\n'));
    }
    printUpdateResults(result.results, Boolean(opts.dryRun || opts.check));
    if (opts.check && cliStatus.updateAvailable) {
      console.log(chalk.yellow(`CLI update available: ${cliStatus.current} -> ${cliStatus.latest}\n`));
    }
  }

  if (opts.check) {
    if (result.needsUpdate || cliStatus.updateAvailable) {
      process.exitCode = 1;
    }
    return;
  }

  if (!opts.json) {
    await maybeUpdateSelf(opts, cliStatus);
  }
}

async function maybeUpdateSelf(opts, cliStatus) {
  if (!cliStatus.updateAvailable) {
    if (cliStatus.error && !opts.json) {
      console.log(chalk.yellow(`CLI update check skipped: ${cliStatus.error}\n`));
    }
    return;
  }

  const command = await resolveSelfUpdateCommand();
  if (!opts.json) {
    console.log(chalk.yellow(`SetupMyAi CLI ${cliStatus.latest} is available (current ${cliStatus.current}).`));
    console.log(chalk.gray(`Self-update command: ${command.command} ${command.args.join(' ')}\n`));
  }

  if (opts.dryRun) return;

  let shouldUpdateSelf = Boolean(opts.yes);
  if (!shouldUpdateSelf) {
    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldUpdateSelf',
        message: 'Update the SetupMyAi CLI now?',
        default: false,
      },
    ]);
    shouldUpdateSelf = answer.shouldUpdateSelf;
  }

  if (shouldUpdateSelf) {
    await runSelfUpdate({ command });
  }
}

function printInventory(inventory, cli) {
  console.log(chalk.bold('\nSetupMyAi status:\n'));

  if (cli) {
    const marker = cli.updateAvailable ? 'update available' : 'current';
    console.log(`  CLI: ${cli.current}${cli.latest ? ` (latest ${cli.latest}, ${marker})` : ''}`);
    if (cli.error) {
      console.log(chalk.yellow(`  CLI update check: ${cli.error}`));
    }
    console.log('');
  }

  if (inventory.items.length === 0) {
    console.log(chalk.yellow('  No installed or unmanaged AI config found.\n'));
    return;
  }

  const grouped = new Map();
  for (const item of inventory.items) {
    const key = `${item.level}/${item.tool}/${item.packageKey || 'unmanaged'}/${item.status}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  for (const [key, items] of [...grouped.entries()].sort()) {
    console.log(chalk.blue(`  ${key}`));
    for (const item of items.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath))) {
      const statusColor = {
        current: chalk.green,
        outdated: chalk.yellow,
        modified: chalk.red,
        missing: chalk.red,
        unmanaged: chalk.gray,
        orphaned: chalk.red,
      }[item.status] || chalk.white;
      console.log(`    ${statusColor(item.status.padEnd(10))} ${chalk.gray(item.type.padEnd(8))} ${item.destinationPath}`);
      if (item.status === 'modified' && item.sourcePath) {
        console.log(chalk.gray(`      source: ${item.sourcePath}`));
      }
    }
    console.log('');
  }

  const statusSummary = Object.entries(inventory.summary.byStatus)
    .map(([status, count]) => `${status}:${count}`)
    .join(', ');
  console.log(chalk.gray(`  Total: ${inventory.summary.total} item(s)${statusSummary ? ` (${statusSummary})` : ''}\n`));
}

function printUpdateResults(results, dryRun) {
  const actionable = results.filter((result) => result.result === 'updated' || result.result === 'would-update');
  const modified = results.filter((result) => result.result === 'skipped-modified');

  console.log(chalk.bold(dryRun ? '\nSetupMyAi update dry run:\n' : '\nSetupMyAi update:\n'));

  if (actionable.length === 0) {
    console.log(chalk.green('  No managed updates to apply.'));
  } else {
    for (const result of actionable) {
      const label = result.result === 'would-update' ? 'would update' : 'updated';
      console.log(`  ${chalk.green(label.padEnd(12))} ${chalk.gray(result.status.padEnd(8))} ${result.destinationPath}`);
      if (result.status === 'modified' && result.sourcePath) {
        console.log(chalk.gray(`              source: ${result.sourcePath}`));
      }
    }
  }

  if (modified.length > 0) {
    console.log(chalk.yellow('\n  Modified managed files were skipped. Use --force to overwrite:'));
    for (const result of modified) {
      console.log(`  ${chalk.yellow('skipped'.padEnd(12))} ${result.destinationPath}`);
      console.log(chalk.gray(`              source: ${result.sourcePath}`));
    }
  }

  const skipped = results.filter((result) => result.result?.startsWith('skipped-') && result.result !== 'skipped-current' && result.result !== 'skipped-modified');
  if (skipped.length > 0) {
    console.log(chalk.gray('\n  Other skipped items:'));
    for (const result of skipped) {
      console.log(chalk.gray(`  ${result.result.padEnd(18)} ${result.destinationPath}`));
    }
  }

  console.log('');
}
