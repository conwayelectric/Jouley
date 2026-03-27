const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Explicitly set server root to project root to prevent Metro from computing
// a wrong relative path for expo-router/entry when rewriting the virtual entry URL.
// Without this, getMetroServerRoot() can return a different value than projectRoot
// causing the entry to resolve as 'expo-router/entry' (relative) instead of
// 'node_modules/expo-router/entry' (absolute), breaking Expo Go on device.
config.server = {
  ...config.server,
  unstable_serverRoot: projectRoot,
};

// Ensure Metro can resolve modules from the project's node_modules
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [path.resolve(projectRoot, "node_modules")],
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});
