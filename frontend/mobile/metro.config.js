// Metro config for the Expo app inside an npm-workspaces monorepo.
// Default Metro only watches its own project root and resolves
// node_modules from there, which means it can't see sibling workspace
// packages like @my239/shared. This config:
//   • adds the workspace root to watchFolders so Metro picks up edits
//     to shared/ live.
//   • adds the workspace's hoisted node_modules to the resolver search
//     path (npm hoists most deps to the root).
//   • disables hierarchical lookup so a missing dep fails fast instead
//     of being silently resolved from some unrelated parent.
//
// Stays a CommonJS file because Metro reads it via require() before any
// transpilation happens.

const {getDefaultConfig} = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true

module.exports = config
