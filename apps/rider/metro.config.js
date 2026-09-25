// Metro does not understand pnpm workspaces on its own: without this it resolves
// the entry point against the repo root and cannot see @gera/core, @gera/data or
// @gera/ui, which live outside this app's own node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits to packages/* trigger a rebuild.
config.watchFolders = [workspaceRoot];

// Resolve from this app first, then the workspace root - pnpm puts the real
// package directories in the root store and symlinks them in.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Stop Metro walking further up and finding a stray node_modules above the repo.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
