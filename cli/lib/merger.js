import fs from 'fs-extra';
import path from 'path';

/**
 * Deep merge hooks into an existing settings.json without clobbering.
 * Creates the file if it doesn't exist.
 */
export async function mergeSettings(existingSettingsPath, newHooksConfig) {
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
        const alreadyExists = existing.hooks[event].some(
          (h) => h.command === entry.command
        );
        if (!alreadyExists) {
          existing.hooks[event].push(entry);
        }
      }
    }
  }

  // Merge any other top-level keys (non-hooks)
  for (const [key, value] of Object.entries(newHooksConfig)) {
    if (key === 'hooks') continue;
    if (existing[key] === undefined) {
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
export async function mergeMcpConfig(existingMcpPath, newMcpConfig) {
  let existing = {};
  if (await fs.pathExists(existingMcpPath)) {
    existing = await fs.readJson(existingMcpPath);
  }

  existing.mcpServers = existing.mcpServers || {};

  for (const [serverName, serverConfig] of Object.entries(
    newMcpConfig.mcpServers || {}
  )) {
    if (!existing.mcpServers[serverName]) {
      existing.mcpServers[serverName] = serverConfig;
    }
  }

  await fs.ensureDir(path.dirname(existingMcpPath));
  await fs.writeJson(existingMcpPath, existing, { spaces: 2 });
  return existing;
}
