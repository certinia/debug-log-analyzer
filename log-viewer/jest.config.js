/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  transform: {
    // transform files with ts-jest
    "^.+\\.(js|ts)$": "ts-jest",
  },
  transformIgnorePatterns: [
    // allow lit/@lit transformation
    "node_modules/(?!\@?lit)"
  ],
  moduleNameMapper: {
    '^.+\\.(css|less)$': '<rootDir>/resources/css/stub.js'
  },
  globals: {
    "ts-jest": {
      tsconfig: {
        // allow js in typescript
        allowJs: true,
      },
    },
  },
};

