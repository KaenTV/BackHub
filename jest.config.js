module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/interface/script'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'interface/script/**/*.js',
    '!interface/script/**/*.test.js',
    '!interface/script/items-data.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true
}

