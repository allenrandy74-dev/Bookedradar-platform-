module.exports = {
  preset: "jest-expo",
  testMatch: ["**/tests/screens.test.tsx"],
  testPathIgnorePatterns: ["/node_modules/", "/build/"],
  clearMocks: true,
};
