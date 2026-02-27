#!/usr/bin/env node

/**
 * Upload ax-web-readiness dataset to Hugging Face.
 *
 * Requires HF_TOKEN environment variable with write access.
 *
 * Usage:
 *   HF_TOKEN=hf_xxx node upload.js
 */

import { createRepo, uploadFiles, whoAmI } from '@huggingface/hub';
import fs from 'node:fs';
import path from 'node:path';

const REPO_NAME = 'lucioduran/ax-web-readiness';
const OUTPUT_DIR = path.join(import.meta.dirname, 'output');
const DATA_FILE = path.join(OUTPUT_DIR, 'data.jsonl');
const README_FILE = path.join(import.meta.dirname, 'README.md');

async function main() {
  const token = process.env.HF_TOKEN;
  if (!token) {
    console.error('Error: HF_TOKEN environment variable is required.');
    console.error('Create a write token at https://huggingface.co/settings/tokens');
    process.exit(1);
  }

  if (!fs.existsSync(DATA_FILE)) {
    console.error(`Error: ${DATA_FILE} not found. Run the crawl first: node crawl.js`);
    process.exit(1);
  }

  if (!fs.existsSync(README_FILE)) {
    console.error(`Error: ${README_FILE} not found.`);
    process.exit(1);
  }

  const credentials = { accessToken: token };
  const repo = { type: 'dataset', name: REPO_NAME };

  // Verify authentication
  console.log('Verifying HF token...');
  const user = await whoAmI({ credentials });
  console.log(`  Authenticated as: ${user.name}`);

  // Create repo if it doesn't exist
  console.log(`\nEnsuring repo ${REPO_NAME} exists...`);
  try {
    await createRepo({ repo, credentials });
    console.log('  Created new dataset repo.');
  } catch (err) {
    if (err.message?.includes('already')) {
      console.log('  Repo already exists.');
    } else {
      throw err;
    }
  }

  // Count rows for commit message
  const lineCount = fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(Boolean).length;

  // Upload files
  console.log(`\nUploading ${lineCount} rows...`);

  const dataContent = new Blob([fs.readFileSync(DATA_FILE)]);
  const readmeContent = new Blob([fs.readFileSync(README_FILE)]);

  await uploadFiles({
    repo,
    credentials,
    files: [
      { path: 'data.jsonl', content: dataContent },
      { path: 'README.md', content: readmeContent },
    ],
    commitTitle: `Update dataset — ${lineCount.toLocaleString()} domains — ${new Date().toISOString().slice(0, 10)}`,
  });

  console.log(`\n✅ Upload complete!`);
  console.log(`   https://huggingface.co/datasets/${REPO_NAME}`);
}

main().catch((err) => {
  console.error('Upload failed:', err);
  process.exit(1);
});
