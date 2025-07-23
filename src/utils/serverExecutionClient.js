const { ExecutionClient } = require('./ExecutionClient');

const nodeFetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const serverExecutionClient = new ExecutionClient({
  baseUrl: 'http://localhost:4000/internal/v1/data',
  authStrategy: () => ({
    'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_TELEGRAM || process.env.INTERNAL_API_KEY_GENERAL || '',
  }),
  fetchImpl: nodeFetch,
});

module.exports = serverExecutionClient; 