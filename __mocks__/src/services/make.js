// Manual mock for make.js

const buildPromptObjFromWorkflow = jest.fn();
const generate = jest.fn();
const fetchOutput = jest.fn();

module.exports = {
  buildPromptObjFromWorkflow,
  generate,
  fetchOutput
}; 