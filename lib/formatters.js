'use strict';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', red: '\x1b[31m',
};

function color(name, text) {
  return `${c[name] || ''}${text}${c.reset}`;
}

function isJSON() {
  return !process.stdout.isTTY || process.argv.includes('--json');
}

function outputJobs(jobs) {
  if (isJSON()) return console.log(JSON.stringify(jobs, null, 2));
  if (!jobs || jobs.length === 0) {
    console.log(color('dim', 'No jobs found.'));
    return;
  }
  for (const job of jobs) {
    const modality = job.modality ? color('cyan', `[${job.modality}]`) : '';
    const location = job.location ? color('dim', job.location) : '';
    console.log(`${color('bold', job.title)} ${modality}`);
    console.log(`  ${color('blue', job.company_name)} | ${location}`);
    console.log(`  ID: ${color('dim', job.id)} | Posted: ${color('dim', job.posted_at || job.first_seen_at || 'unknown')}`);
    if (job.url) console.log(`  ${color('dim', job.url)}`);
    console.log();
  }
}

function outputCompanies(companies) {
  if (isJSON()) return console.log(JSON.stringify(companies, null, 2));
  if (!companies || companies.length === 0) {
    console.log(color('dim', 'No companies found.'));
    return;
  }
  for (const co of companies) {
    const count = co.active_jobs_count || co.job_count || 0;
    console.log(`${color('bold', co.name)} — ${color('cyan', count + ' jobs')}`);
    if (co.domain) console.log(`  ${color('dim', co.domain)}`);
    console.log();
  }
}

function outputStats(stats) {
  if (isJSON()) return console.log(JSON.stringify(stats, null, 2));
  console.log(color('bold', 'Trackly Stats'));
  console.log();
  if (stats.totalJobs !== undefined) console.log(`Total Jobs: ${color('cyan', stats.totalJobs)}`);
  if (stats.totalCompanies !== undefined) console.log(`Companies: ${color('cyan', stats.totalCompanies)}`);
  if (stats.appliedCount !== undefined) console.log(`Applied: ${color('green', stats.appliedCount)}`);
  if (stats.savedCount !== undefined) console.log(`Saved: ${color('yellow', stats.savedCount)}`);
  // Print any other keys
  for (const [k, v] of Object.entries(stats)) {
    if (!['totalJobs', 'totalCompanies', 'appliedCount', 'savedCount'].includes(k)) {
      console.log(`${k}: ${color('dim', JSON.stringify(v))}`);
    }
  }
}

function outputError(msg) {
  console.error(color('red', `Error: ${msg}`));
}

module.exports = { color, isJSON, outputJobs, outputCompanies, outputStats, outputError };
