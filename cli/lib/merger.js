import fs from 'fs-extra';
import path from 'path';

export function getHookEntryKey(entry) {
  if (entry && Object.hasOwn(entry, 'command')) {
    return `matcher:${entry.matcher || ''}|command:${entry.command}`;
  }
  const nestedHooks = Array.isArray(entry?.hooks)
    ? entry.hooks.map((hook) => ({
      type: hook?.type || '',
      command: hook?.command || '',
    }))
    : [];
  if (nestedHooks.length > 0) {
    return `matcher:${entry.matcher || ''}|hooks:${JSON.stringify(nestedHooks)}`;
  }
  return JSON.stringify(entry);
}

/**
 * Deep merge hooks into an existing settings.json without clobbering.
 * Creates the file if it doesn't exist.
 */
export async function mergeSettings(existingSettingsPath, newHooksConfig, options = {}) {
  const overwriteManaged = options.overwriteManaged === true;
  let existing = {};
  if (await fs.pathExists(existingSettingsPath)) {
    existing = await fs.readJson(existingSettingsPath);
  }

  // Deep merge hooks -- each hook event is an array, so we concat and dedupe
  if (newHooksConfig.hooks) {
    existing.hooks = existing.hooks || {};
    for (const [event, hookEntries] of Object.entries(newHooksConfig.hooks)) {
      existing.hooks[event] = existing.hooks[event] || [];
      for (const entry of hookEntries) {
        const existingIndex = existing.hooks[event].findIndex(
          (candidate) => getHookEntryKey(candidate) === getHookEntryKey(entry)
        );
        if (existingIndex === -1) {
          existing.hooks[event].push(entry);
        } else if (overwriteManaged) {
          existing.hooks[event][existingIndex] = entry;
        }
      }
    }
  }

  // Merge any other top-level keys (non-hooks)
  for (const [key, value] of Object.entries(newHooksConfig)) {
    if (key === 'hooks') continue;
    if (existing[key] === undefined || overwriteManaged) {
      existing[key] = value;
    }
  }

  await fs.ensureDir(path.dirname(existingSettingsPath));
  await fs.writeJson(existingSettingsPath, existing, { spaces: 2 });
  return existing;
}

/**
 * Merge MCP server entries into .cursor/mcp.json without overwriting existing servers.
 */
export async function mergeMcpConfig(existingMcpPath, newMcpConfig, options = {}) {
  const overwriteManaged = options.overwriteManaged === true;
  let existing = {};
  if (await fs.pathExists(existingMcpPath)) {
    existing = await fs.readJson(existingMcpPath);
  }

  existing.mcpServers = existing.mcpServers || {};

  for (const [serverName, serverConfig] of Object.entries(
    newMcpConfig.mcpServers || {}
  )) {
    if (!existing.mcpServers[serverName] || overwriteManaged) {
      existing.mcpServers[serverName] = serverConfig;
    }
  }

  await fs.ensureDir(path.dirname(existingMcpPath));
  await fs.writeJson(existingMcpPath, existing, { spaces: 2 });
  return existing;
}
