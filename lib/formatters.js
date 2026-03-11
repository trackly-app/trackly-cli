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

function outputContacts(contacts) {
  if (isJSON()) return console.log(JSON.stringify(contacts, null, 2));
  if (!contacts || contacts.length === 0) {
    console.log(color('dim', 'No contacts found.'));
    return;
  }
  // Header
  console.log(
    color('bold', padRight('Name', 24)) + ' ' +
    color('bold', padRight('Title', 28)) + ' ' +
    color('bold', padRight('Company', 20)) + ' ' +
    color('bold', padRight('Email', 28)) + ' ' +
    color('bold', 'Status')
  );
  console.log(color('dim', '-'.repeat(110)));
  for (const contact of contacts) {
    const name = padRight(contact.name || '', 24);
    const title = padRight(contact.title || '', 28);
    const company = padRight(contact.company || '', 20);
    const email = padRight(contact.email || '', 28);
    const status = contact.status || '';
    const statusColor = status === 'active' ? 'green' : status === 'pending' ? 'yellow' : 'dim';
    console.log(
      `${name} ${title} ${company} ${email} ${color(statusColor, status)}`
    );
  }
}

function outputReferralCampaign(campaign) {
  if (isJSON()) return console.log(JSON.stringify(campaign, null, 2));
  if (!campaign) {
    console.log(color('dim', 'No campaign data.'));
    return;
  }
  console.log(color('bold', 'Referral Campaign'));
  console.log();
  if (campaign.id) console.log(`Campaign ID: ${color('cyan', campaign.id)}`);
  if (campaign.jobId) console.log(`Job ID: ${color('dim', campaign.jobId)}`);
  if (campaign.status) {
    const statusColor = campaign.status === 'active' ? 'green' : campaign.status === 'completed' ? 'blue' : 'yellow';
    console.log(`Status: ${color(statusColor, campaign.status)}`);
  }
  if (campaign.createdAt) console.log(`Created: ${color('dim', campaign.createdAt)}`);
  if (campaign.company) console.log(`Company: ${color('blue', campaign.company)}`);
  if (campaign.jobTitle) console.log(`Job: ${color('bold', campaign.jobTitle)}`);

  if (campaign.contacts && campaign.contacts.length > 0) {
    console.log();
    console.log(color('bold', 'Outreach Progress:'));
    for (const c of campaign.contacts) {
      const icon = c.status === 'sent' ? color('green', '[sent]') :
                   c.status === 'replied' ? color('cyan', '[replied]') :
                   c.status === 'pending' ? color('yellow', '[pending]') :
                   color('dim', `[${c.status || 'unknown'}]`);
      console.log(`  ${icon} ${c.name || 'Unknown'}${c.title ? ' — ' + color('dim', c.title) : ''}`);
    }
  }

  // Print any other top-level keys
  for (const [k, v] of Object.entries(campaign)) {
    if (!['id', 'jobId', 'status', 'createdAt', 'company', 'jobTitle', 'contacts'].includes(k)) {
      console.log(`${k}: ${color('dim', JSON.stringify(v))}`);
    }
  }
}

function outputNetworkBrief(brief) {
  if (isJSON()) return console.log(JSON.stringify(brief, null, 2));
  if (!brief) {
    console.log(color('dim', 'No network brief available.'));
    return;
  }
  console.log(color('bold', 'Network Brief'));
  console.log();

  if (brief.companySignal) {
    console.log(color('bold', 'Company Signal:'));
    console.log(`  ${brief.companySignal}`);
    console.log();
  }

  if (brief.recommendedMotion) {
    console.log(color('bold', 'Recommended Motion:'));
    console.log(`  ${color('cyan', brief.recommendedMotion)}`);
    console.log();
  }

  if (brief.topContact) {
    console.log(color('bold', 'Top Contact:'));
    const tc = brief.topContact;
    if (tc.name) console.log(`  Name: ${tc.name}`);
    if (tc.title) console.log(`  Title: ${color('dim', tc.title)}`);
    if (tc.company) console.log(`  Company: ${color('blue', tc.company)}`);
    if (tc.email) console.log(`  Email: ${color('cyan', tc.email)}`);
    if (tc.reason) console.log(`  Why: ${color('dim', tc.reason)}`);
    console.log();
  }

  if (brief.actions && brief.actions.length > 0) {
    console.log(color('bold', 'Actions:'));
    for (let i = 0; i < brief.actions.length; i++) {
      const action = brief.actions[i];
      if (typeof action === 'string') {
        console.log(`  ${color('green', (i + 1) + '.')} ${action}`);
      } else {
        console.log(`  ${color('green', (i + 1) + '.')} ${action.description || JSON.stringify(action)}`);
      }
    }
    console.log();
  }

  // Print any other top-level keys
  for (const [k, v] of Object.entries(brief)) {
    if (!['companySignal', 'recommendedMotion', 'topContact', 'actions'].includes(k)) {
      console.log(`${k}: ${color('dim', JSON.stringify(v))}`);
    }
  }
}

function padRight(str, len) {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

function outputError(msg) {
  console.error(color('red', `Error: ${msg}`));
}

module.exports = { color, isJSON, outputJobs, outputCompanies, outputStats, outputContacts, outputReferralCampaign, outputNetworkBrief, outputError };
