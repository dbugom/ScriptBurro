import { api } from '../shared/browser.js';
import { getSettings } from './store.js';

export const UPDATE_ALARM = 'td-update';
export const HOUSEKEEPING_ALARM = 'td-housekeeping';

export async function scheduleUpdates() {
  const { updateIntervalHours } = await getSettings();
  await api.alarms.clear(UPDATE_ALARM);
  if (updateIntervalHours > 0) {
    api.alarms.create(UPDATE_ALARM, { delayInMinutes: 5, periodInMinutes: Math.max(1, updateIntervalHours) * 60 });
  }
  api.alarms.create(HOUSEKEEPING_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}
