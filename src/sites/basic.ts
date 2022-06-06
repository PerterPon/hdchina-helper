

export interface TPageUserInfo {
  shareRatio: string;
  uploadCount: string;
  downloadCount: string;
  magicPoint: string;
}

import * as hdchina from './hdchina';
import * as mteam from './mteam'
import * as mteamLite from './mteam-lite';
import * as hdtimeLite from './hdtime-lite';
import * as config from '../config';

export const siteMap = {
  hdchina,
  mteam: mteamLite,
  hdtime: hdtimeLite
};

export function getCurrentSite() {
  return siteMap[config.site];
}
