'use strict';

// "Favorite a list" MCP tools (close-ai #3867). Mirrors close-ai src/mcp/favorite-companies-tool.ts:
// same descriptions, limits and request body. Both servers call the same REST endpoints, so company
// matching, the request quota and the 100-company cap are enforced server-side.

const { z } = require('zod');

const FAVORITE_COMPANIES_MAX = 100;

const FAVORITE_COMPANIES_DESCRIPTION = 'Favorite a list of companies in one call: up to 100 in total across '
  + 'companyIds, names and requestNames. names takes company names or website/careers URLs and Trackly matches each '
  + 'one. The result lists favorited (newly favorited), alreadyFavorite, needsChoice (a name that matched a '
  + 'differently named company, such as "Square" matching Block, a likely misspelling, or several companies; '
  + 'nothing was written for it), requested (a company Trackly does not monitor yet, now requested), favoriteWhenAdded (requested companies '
  + 'that will be favorited automatically once Trackly adds them) and failed (with a code such as company_not_found, '
  + 'company_inactive, rate_limited with retryAfterSeconds, unidentified_url for a job link that names no '
  + 'employer, or invalid_request). For each needsChoice item, ask the '
  + 'user, then call again with the chosen company in companyIds, or with the original name in requestNames to '
  + 'request it separately. Safe to repeat: already favorited companies and pending requests are reused. Company '
  + 'requests share the account limit of 20 per rolling 60 seconds.';

const UNFAVORITE_COMPANIES_DESCRIPTION = 'Remove up to 100 companies from the user\'s favorites by company ID, '
  + 'for example to undo trackly_favorite_companies. The result lists unfavorited, notFavorite (was not a favorite) '
  + 'and failed (company_not_found). Safe to repeat.';

const companyIdList = z.array(z.number().int().positive()).max(FAVORITE_COMPANIES_MAX);
const nameList = z.array(z.string().min(1).max(2048)).max(FAVORITE_COMPANIES_MAX);

const favoriteCompaniesInputShape = {
  companyIds: companyIdList.optional().describe('Trackly company IDs to favorite, e.g. from trackly_search_companies.'),
  names: nameList.optional().describe('Company names or website/careers URLs to match and favorite, e.g. ["Stripe", "https://ramp.com"].'),
  requestNames: nameList.optional().describe('Company names to request without matching, favorited automatically once Trackly adds them. Use for a needsChoice item the user wants requested separately.'),
};

const unfavoriteCompaniesInputShape = {
  companyIds: companyIdList.min(1).describe('Trackly company IDs to remove from favorites.'),
};

function favoriteCompaniesRequestBody({ companyIds, names, requestNames } = {}) {
  const total = (companyIds ? companyIds.length : 0) + (names ? names.length : 0) + (requestNames ? requestNames.length : 0);
  if (total > FAVORITE_COMPANIES_MAX) {
    throw new Error(`At most ${FAVORITE_COMPANIES_MAX} companies per call in total across companyIds, names and requestNames (got ${total}).`);
  }
  return {
    ...(companyIds && companyIds.length ? { companyIds } : {}),
    ...(names && names.length ? { names } : {}),
    ...(requestNames && requestNames.length
      ? { requests: requestNames.map((query) => ({ query, favoriteWhenAdded: true })) }
      : {}),
    source: 'mcp',
  };
}

module.exports = {
  FAVORITE_COMPANIES_MAX,
  favoriteCompaniesInputShape,
  unfavoriteCompaniesInputShape,
  FAVORITE_COMPANIES_DESCRIPTION,
  UNFAVORITE_COMPANIES_DESCRIPTION,
  favoriteCompaniesRequestBody,
};
