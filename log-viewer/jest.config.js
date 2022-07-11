/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    // transform files with ts-jest
    "^.+\\.(js|ts)$": "ts-jest",
  },
  transformIgnorePatterns: [
    // allow lit/@lit transformation
    "node_modules/(?!@?lit)",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/out/"
  ],
  moduleNameMapper: {
    '^.+\\.(css|less)$': '<rootDir>/resources/css/stub.js'
  },
  globals: {
    "ts-jest": {
      isolatedModules: true,
      tsconfig: {
        // allow js in typescript
        allowJs: true,
      },
    },
  },
};
