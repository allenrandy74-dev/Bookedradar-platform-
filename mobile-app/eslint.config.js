const { defineConfig } = require("eslint/config");
const expo = require("eslint-config-expo/flat");
module.exports = defineConfig([
  expo,
  { ignores: ["build/**", "qa/**"] },
  { rules: { "react/no-unescaped-entities": "off" } },
]);
