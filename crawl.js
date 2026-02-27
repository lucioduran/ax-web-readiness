#!/usr/bin/env node

/**
 * ax-web-readiness crawl script
 *
 * Downloads the Tranco top-sites list, audits each domain with ax-audit,
 * and outputs a flat JSONL dataset suitable for Hugging Face.
 *
 * Usage:
 *   node crawl.js                  # full 10K crawl
 *   node crawl.js --limit 100      # top 100 only
 *   node crawl.js --concurrency 5  # 5 parallel audits
 *   node crawl.js --resume          # resume from existing output
 */

import { audit } from 'ax-audit';
import pLimit from 'p-limit';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const OUTPUT_DIR = path.join(import.meta.dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'data.jsonl');
const TRANCO_URL = 'https://tranco-list.eu/top-1m.csv.zip';
const TRANCO_CSV = path.join(OUTPUT_DIR, 'tranco.csv');

const DEFAULT_LIMIT = 10_000;
const DEFAULT_CONCURRENCY = 10;
const AUDIT_TIMEOUT = 15_000;

const CHECK_IDS = [
  'llms-txt',
  'robots-txt',
  'structured-data',
  'http-headers',
  'agent-json',
  'mcp',
  'security-txt',
  'meta-tags',
  'openapi',
];

// Maps check ID → column prefix (e.g., "llms-txt" → "llms_txt")
const colPrefix = (id) => id.replace(/-/g, '_');

/* ── CLI args ── */

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    resume: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      opts.concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--resume') {
      opts.resume = true;
    }
  }

  return opts;
}

/* ── Tranco download ── */

async function downloadTranco() {
  if (fs.existsSync(TRANCO_CSV)) {
    console.log(`  Using cached ${TRANCO_CSV}`);
    return;
  }

  console.log(`  Downloading Tranco list from ${TRANCO_URL}...`);

  const res = await fetch(TRANCO_URL);
  if (!res.ok) throw new Error(`Failed to download Tranco: ${res.status}`);

  // The response is a zip file. We need to decompress it.
  // Node 21+ has built-in DecompressionStream for gzip but not zip.
  // Tranco also provides a plain CSV endpoint.
  // Use the direct CSV URL instead.
  const csvUrl = 'https://tranco-list.eu/top-1m.csv.zip';

  // Actually, let's use the unzipped version via a different approach.
  // Tranco provides daily lists. We'll download the zip and extract.
  const zipBuffer = Buffer.from(await res.arrayBuffer());

  // Simple ZIP extraction — the CSV is the only file in the archive.
  // ZIP local file header: PK\x03\x04 at offset 0
  // We find the file data after the local header.
  const localHeaderEnd = findZipDataOffset(zipBuffer);
  if (localHeaderEnd === -1) throw new Error('Invalid ZIP file');

  // Find the end of compressed data using the central directory
  const centralDirOffset = zipBuffer.readUInt32LE(zipBuffer.length - 6);

  // Check compression method (offset 8 in local header)
  const compressionMethod = zipBuffer.readUInt16LE(8);

  if (compressionMethod === 0) {
    // Stored (no compression)
    const compressedSize = zipBuffer.readUInt32LE(18);
    const csvData = zipBuffer.subarray(localHeaderEnd, localHeaderEnd + compressedSize);
    fs.writeFileSync(TRANCO_CSV, csvData);
  } else if (compressionMethod === 8) {
    // Deflate — use zlib
    const { inflateRawSync } = await import('node:zlib');
    const compressedSize = zipBuffer.readUInt32LE(18);
    const compressed = zipBuffer.subarray(localHeaderEnd, localHeaderEnd + compressedSize);
    const csvData = inflateRawSync(compressed);
    fs.writeFileSync(TRANCO_CSV, csvData);
  } else {
    throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
  }

  console.log(`  Saved to ${TRANCO_CSV}`);
}

function findZipDataOffset(buf) {
  // PK\x03\x04 signature
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) return -1;

  const fnameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  return 30 + fnameLen + extraLen;
}

/* ── Parse Tranco CSV ── */

async function parseTranco(limit) {
  const domains = [];
  const rl = createInterface({ input: createReadStream(TRANCO_CSV, 'utf8') });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const [rank, domain] = line.split(',');
    if (domain) {
      domains.push({ rank: parseInt(rank, 10), domain: domain.trim() });
    }
    if (domains.length >= limit) break;
  }

  return domains;
}

/* ── Transform AuditReport → flat row ── */

function transformReport(rank, domain, report) {
  const row = {
    rank,
    domain,
    url: report.url,
    overall_score: report.overallScore,
    grade_label: report.grade.label,
    grade_color: report.grade.color,
    duration_ms: report.duration,
  };

  // Per-check scores and finding counts
  for (const checkId of CHECK_IDS) {
    const prefix = colPrefix(checkId);
    const result = report.results.find((r) => r.id === checkId);

    if (result) {
      row[`${prefix}_score`] = result.score;
      row[`${prefix}_pass`] = result.findings.filter((f) => f.status === 'pass').length;
      row[`${prefix}_warn`] = result.findings.filter((f) => f.status === 'warn').length;
      row[`${prefix}_fail`] = result.findings.filter((f) => f.status === 'fail').length;
    } else {
      row[`${prefix}_score`] = 0;
      row[`${prefix}_pass`] = 0;
      row[`${prefix}_warn`] = 0;
      row[`${prefix}_fail`] = 0;
    }
  }

  // Boolean has_* flags — derived from "not found" findings
  const hasFile = (checkId) => {
    const result = report.results.find((r) => r.id === checkId);
    if (!result) return false;
    const notFound = result.findings.some(
      (f) => f.status === 'fail' && f.message.toLowerCase().includes('not found'),
    );
    return !notFound;
  };

  row.has_llms_txt = hasFile('llms-txt');
  row.has_robots_txt = hasFile('robots-txt');
  row.has_agent_json = hasFile('agent-json');
  row.has_mcp_json = hasFile('mcp');
  row.has_security_txt = hasFile('security-txt');
  row.has_openapi = hasFile('openapi');

  row.timestamp = report.timestamp;

  return row;
}

/* ── Failed audit → flat row with zeros ── */

function failedRow(rank, domain, error) {
  const row = {
    rank,
    domain,
    url: `https://${domain}`,
    overall_score: 0,
    grade_label: 'Poor',
    grade_color: 'red',
    duration_ms: 0,
  };

  for (const checkId of CHECK_IDS) {
    const prefix = colPrefix(checkId);
    row[`${prefix}_score`] = 0;
    row[`${prefix}_pass`] = 0;
    row[`${prefix}_warn`] = 0;
    row[`${prefix}_fail`] = 0;
  }

  row.has_llms_txt = false;
  row.has_robots_txt = false;
  row.has_agent_json = false;
  row.has_mcp_json = false;
  row.has_security_txt = false;
  row.has_openapi = false;

  row.timestamp = new Date().toISOString();
  row.error = error;

  return row;
}

/* ── Resume: load already-crawled domains ── */

function loadProcessedDomains() {
  const processed = new Set();
  if (!fs.existsSync(OUTPUT_FILE)) return processed;

  const content = fs.readFileSync(OUTPUT_FILE, 'utf8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.domain) processed.add(row.domain);
    } catch {
      // skip malformed lines
    }
  }

  return processed;
}

/* ── Main ── */

async function main() {
  const opts = parseArgs();

  console.log(`\n🔍 ax-web-readiness dataset crawl`);
  console.log(`   Limit: ${opts.limit} domains`);
  console.log(`   Concurrency: ${opts.concurrency}`);
  console.log(`   Resume: ${opts.resume}\n`);

  // Ensure output dir exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1: Download Tranco
  console.log('Step 1/3: Tranco list');
  await downloadTranco();

  // Step 2: Parse domains
  console.log('Step 2/3: Parsing domains');
  const allDomains = await parseTranco(opts.limit);
  console.log(`  Loaded ${allDomains.length} domains`);

  // Filter already processed if resuming
  let domains = allDomains;
  if (opts.resume) {
    const processed = loadProcessedDomains();
    domains = allDomains.filter((d) => !processed.has(d.domain));
    console.log(`  Resuming: ${processed.size} already done, ${domains.length} remaining`);
  } else {
    // Start fresh
    if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);
  }

  if (domains.length === 0) {
    console.log('\n✅ All domains already processed.');
    return;
  }

  // Step 3: Audit
  console.log(`Step 3/3: Auditing ${domains.length} domains\n`);

  const limit = pLimit(opts.concurrency);
  const startTime = Date.now();
  let completed = 0;
  let errors = 0;
  let scoreSum = 0;

  const fd = fs.openSync(OUTPUT_FILE, 'a');

  const tasks = domains.map(({ rank, domain }) =>
    limit(async () => {
      let row;
      try {
        const report = await audit({ url: `https://${domain}`, timeout: AUDIT_TIMEOUT });
        row = transformReport(rank, domain, report);
        scoreSum += report.overallScore;
      } catch (err) {
        row = failedRow(rank, domain, err.message);
        errors++;
      }

      // Append to JSONL
      fs.writeSync(fd, JSON.stringify(row) + '\n');

      completed++;
      if (completed % 100 === 0 || completed === domains.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (completed / ((Date.now() - startTime) / 1000)).toFixed(1);
        const avgScore = (scoreSum / (completed - errors || 1)).toFixed(1);
        console.log(
          `  [${completed}/${domains.length}] ${elapsed}s | ${rate} domains/s | avg score: ${avgScore} | errors: ${errors}`,
        );
      }
    }),
  );

  await Promise.all(tasks);
  fs.closeSync(fd);

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgScore = (scoreSum / (completed - errors || 1)).toFixed(1);

  console.log(`\n══════════════════════════════════════`);
  console.log(`  ✅ Crawl complete`);
  console.log(`  Domains: ${completed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Avg score: ${avgScore}`);
  console.log(`  Time: ${totalTime}s`);
  console.log(`  Output: ${OUTPUT_FILE}`);
  console.log(`══════════════════════════════════════\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
