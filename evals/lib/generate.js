import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { globSync } from 'glob';
import YAML from 'yaml';
import { loadSkillInventory } from './inventory.js';

const GENERATED_HEADER =
  '# Generated from evals/cases.yaml. Edit the canonical case file, then regenerate.\n';

function displayName(id) {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function renderYaml(value) {
  return `${GENERATED_HEADER}${YAML.stringify(value, {
    lineWidth: 100,
  })}`;
}

async function isGeneratedSuiteDirectory(directoryPath) {
  const generatedFiles = ['eval.yaml', 'mock.eval.yaml'];

  for (const filename of generatedFiles) {
    const filePath = path.join(directoryPath, filename);
    if (!(await fs.pathExists(filePath))) {
      return false;
    }
    const contents = await fs.readFile(filePath, 'utf8');
    if (!contents.startsWith(GENERATED_HEADER)) {
      return false;
    }
  }

  return true;
}

export async function generateWazaSuites(repositoryRoot) {
  const casePath = path.join(repositoryRoot, 'evals', 'cases.yaml');
  const caseSet = YAML.parse(await fs.readFile(casePath, 'utf8'));
  const inventory = await loadSkillInventory(repositoryRoot);
  const inventoryByName = new Map(
    inventory.map((skill) => [skill.name, skill])
  );

  if (caseSet.wazaVersion !== '0.38.3') {
    throw new Error('evals/cases.yaml must pin Waza 0.38.3');
  }

  const declaredNames = caseSet.skills.map((skill) => skill.name).sort();
  const inventoryNames = inventory.map((skill) => skill.name).sort();
  if (JSON.stringify(declaredNames) !== JSON.stringify(inventoryNames)) {
    throw new Error('evals/cases.yaml must cover the exact skill inventory');
  }

  const expectedSuiteDirectories = new Set(
    caseSet.skills.map(
      (skill) => `evals/${skill.package}/${skill.directory}`
    )
  );
  const existingSuiteEntries = globSync('evals/*/*', {
    cwd: repositoryRoot,
    nodir: false,
  });
  for (const relativeEntry of existingSuiteEntries) {
    const absoluteEntry = path.join(repositoryRoot, relativeEntry);
    const entryStats = await fs.lstat(absoluteEntry);
    if (
      entryStats.isDirectory() &&
      !expectedSuiteDirectories.has(relativeEntry) &&
      (await isGeneratedSuiteDirectory(absoluteEntry))
    ) {
      await fs.remove(absoluteEntry);
    }
  }

  for (const skill of caseSet.skills) {
    const inventorySkill = inventoryByName.get(skill.name);
    if (
      skill.package !== inventorySkill.packageName ||
      skill.directory !== inventorySkill.directoryName
    ) {
      throw new Error(`${skill.name}: package or directory does not match`);
    }

    const suiteDirectory = path.join(
      repositoryRoot,
      'evals',
      skill.package,
      skill.directory
    );
    const tasksDirectory = path.join(suiteDirectory, 'tasks');
    const mockTasksDirectory = path.join(suiteDirectory, 'mock-tasks');
    await fs.ensureDir(tasksDirectory);
    await fs.ensureDir(mockTasksDirectory);
    await fs.emptyDir(tasksDirectory);
    await fs.emptyDir(mockTasksDirectory);

    const evaluation = {
      name: `${skill.name}-eval`,
      description: `Behavior and routing evaluation for ${skill.name}.`,
      skill: skill.name,
      schemaVersion: '1.2',
      version: '1.0',
      config: {
        trials_per_task: 1,
        timeout_seconds: 300,
        parallel: false,
        executor: 'copilot-sdk',
        model: 'auto',
        skill_directories: [`../../../packages/${skill.package}/skills`],
      },
      metrics: [
        {
          name: 'behavior-contract',
          weight: 1,
          threshold: 0.6,
        },
      ],
      graders: [
        {
          type: 'code',
          name: 'substantive-response',
          config: {
            language: 'javascript',
            assertions: ['output.trim().length > 40'],
          },
        },
        {
          type: 'text',
          name: 'no-fatal-errors',
          config: {
            regex_not_match: ['(?i)fatal error|crashed|unhandled exception'],
          },
        },
      ],
      tasks: ['tasks/*.yaml'],
    };
    await fs.writeFile(
      path.join(suiteDirectory, 'eval.yaml'),
      renderYaml(evaluation)
    );

    const mockEvaluation = {
      name: `${skill.name}-offline-eval`,
      description: `Offline trigger evaluation for ${skill.name}.`,
      skill: skill.name,
      schemaVersion: '1.2',
      version: '1.0',
      config: {
        trials_per_task: 1,
        timeout_seconds: 30,
        parallel: false,
        executor: 'mock',
        model: 'offline-mock',
        inject_skill_body: false,
        skill_directories: [`../../../packages/${skill.package}/skills`],
      },
      metrics: [
        {
          name: 'trigger-accuracy',
          weight: 1,
          threshold: 0.6,
        },
      ],
      tasks: ['mock-tasks/*.yaml'],
    };
    await fs.writeFile(
      path.join(suiteDirectory, 'mock.eval.yaml'),
      renderYaml(mockEvaluation)
    );

    for (const task of skill.tasks) {
      const taskDefinition = {
        id: task.id,
        name: displayName(task.id),
        description: task.contract,
        tags: task.tags,
        inputs: {
          prompt: task.modelPrompt ?? task.prompt,
          ...(task.files ? { files: task.files } : {}),
        },
        expected: {
          outcomes: [{ type: 'task_completed' }],
          behavior: {
            max_tool_calls: task.maxToolCalls ?? 20,
            max_iterations: 10,
            max_tokens: 12000,
            ...(task.forbiddenTools
              ? { forbidden_tools: task.forbiddenTools }
              : {}),
          },
          ...(task.outputContains
            ? { output_contains: task.outputContains }
            : {}),
          ...(task.outputNotContains
            ? { output_not_contains: task.outputNotContains }
            : {}),
        },
        graders: [
          {
            type: 'trigger',
            name: `${task.id}-trigger`,
            config: {
              skill_path: `packages/${skill.package}/skills/${skill.directory}/SKILL.md`,
              mode: task.trigger,
              threshold: 0.6,
            },
          },
          {
            type: 'behavior',
            name: `${task.id}-behavior`,
            config: {
              max_tool_calls: task.maxToolCalls ?? 20,
              ...(task.forbiddenTools
                ? { forbidden_tools: task.forbiddenTools }
                : {}),
            },
          },
          {
            type: 'prompt',
            name: `${task.id}-contract`,
            weight: 2,
            config: {
              model: 'auto',
              continue_session: true,
              prompt: [
                'Judge the agent response against this advertised behavior contract:',
                task.contract,
                '',
                'The response must honor every scope and safety constraint in the user prompt.',
                'It must not claim actions, file contents, or configuration facts that were not evidenced.',
                'If the contract is materially satisfied, call set_waza_grade_pass with a concise reason.',
                'Otherwise call set_waza_grade_fail with the unmet requirement.',
                'Do not return a plain-text verdict instead of calling one of those tools.',
              ].join('\n'),
            },
          },
        ],
      };

      await fs.writeFile(
        path.join(tasksDirectory, `${task.id}.yaml`),
        renderYaml(taskDefinition)
      );

      const mockTaskDefinition = {
        id: task.id,
        name: displayName(task.id),
        description: task.contract,
        tags: task.tags,
        inputs: {
          prompt: task.prompt,
        },
        expected: {},
        graders: [
          {
            type: 'trigger',
            name: `${task.id}-trigger`,
            config: {
              skill_path: `packages/${skill.package}/skills/${skill.directory}/SKILL.md`,
              mode: task.trigger,
              threshold: 0.6,
            },
          },
        ],
      };
      await fs.writeFile(
        path.join(mockTasksDirectory, `${task.id}.yaml`),
        renderYaml(mockTaskDefinition)
      );
    }
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  const repositoryRoot = path.resolve(path.dirname(currentFile), '../..');
  await generateWazaSuites(repositoryRoot);
}
