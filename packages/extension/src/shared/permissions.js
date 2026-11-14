import { grantToApi } from '@tamperdonkey/core';
import { api } from './browser.js';

/**
 * Browser permissions that are only needed by scripts using certain GM functions.
 * They are optional in the manifest and requested when such a script is installed.
 */
const BY_API = { cookie: 'cookies', download: 'downloads' };

export const PERMISSION_LABEL = { cookies: 'read and change cookies', downloads: 'download files' };

export function permissionsForGrants(grants) {
  return [...new Set((grants || []).map((g) => BY_API[grantToApi(g)]).filter(Boolean))];
}

export async function hasPermission(name) {
  try {
    return await api.permissions.contains({ permissions: [name] });
  } catch {
    return false;
  }
}

export async function missingPermissions(grants) {
  const out = [];
  for (const p of permissionsForGrants(grants)) if (!(await hasPermission(p))) out.push(p);
  return out;
}

/**
 * Asks the user for the permissions a script's grants need. Must be called from a click
 * or key handler. Returns the permissions that are still missing afterwards.
 */
export async function requestForGrants(grants) {
  const missing = await missingPermissions(grants);
  if (!missing.length) return [];
  try {
    if (await api.permissions.request({ permissions: missing })) return [];
  } catch { /* not a user gesture, or the browser refused */ }
  return missing;
}
