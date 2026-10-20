// metro.config.js
if (!Array.prototype.toReversed) {
  Array.prototype.toReversed = function() {
    return this.slice().reverse();
  };
}
const { getDefaultConfig } = require("expo/metro-config");

const defaultConfig = getDefaultConfig(__dirname);

// Ensure .gguf (llama.cpp) is treated as an asset, not source code.
// This prevents Metro/Expo from compressing the files.
defaultConfig.resolver.assetExts.push("gguf");

module.exports = defaultConfig;
