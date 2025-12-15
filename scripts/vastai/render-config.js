#!/usr/bin/env node
const fsp = require('fs').promises;
const path = require('path');
const minimist = require('minimist');

const DEFAULT_TEMPLATE = path.resolve(
  __dirname,
  '../../roadmap/vastai-gpu-training/configs/flux-lora-24gb-aitoolkit.yaml'
);
const DEFAULT_JOB_ROOT_PREFIX = '/opt/stationthis/jobs';

function parseVarEntries(entry) {
  if (!entry) return {};
  const entries = Array.isArray(entry) ? entry : [entry];
  return entries.reduce((acc, pair) => {
    const [key, ...rest] = String(pair).split('=');
    if (!key || !rest.length) {
      return acc;
    }
    acc[key.trim()] = rest.join('=').trim();
    return acc;
  }, {});
}

function renderTemplate(content, variables) {
  return content.replace(/{{\s*([A-Z0-9_\.\-]+)\s*}}/gi, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key];
    }
    return match;
  });
}

async function renderConfig({ templatePath, outputPath, variables }) {
  const template = await fsp.readFile(templatePath, 'utf8');
  const rendered = renderTemplate(template, variables);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, rendered, 'utf8');
  return outputPath;
}

async function cli() {
  const args = minimist(process.argv.slice(2), {
    string: ['template', 'output', 'job', 'jobRoot', 'var'],
    alias: {
      t: 'template',
      o: 'output',
      j: 'job',
      r: 'jobRoot',
      v: 'var'
    }
  });

  const jobId = args.job;
  const templatePath = path.resolve(args.template || DEFAULT_TEMPLATE);
  const jobRoot = args.jobRoot || (jobId ? `${DEFAULT_JOB_ROOT_PREFIX}/${jobId}` : null);

  if (!jobRoot) {
    throw new Error('Provide --job-root or --job so the config can point at the remote dataset path.');
  }

  const varsFromFlags = parseVarEntries(args.var);
  const variables = {
    JOB_ROOT: jobRoot,
    ...varsFromFlags
  };

  const outputPath = path.resolve(
    args.output ||
      path.join(process.cwd(), '.stationthis', 'jobs', jobId || 'manual', 'config', path.basename(templatePath))
  );

  await renderConfig({ templatePath, outputPath, variables });
  console.log(`Rendered config written to ${outputPath}`);
}

if (require.main === module) {
  cli().catch((error) => {
    console.error('render-config failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  renderConfig,
  renderTemplate
};
