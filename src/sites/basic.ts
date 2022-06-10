

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
import * as hdchinaLite from './hdchina-lite';
import * as sjtuLite from './sjtu-lite'
import * as config from '../config';

export const siteMap = {
  hdchina: hdchina,
  mteam: mteamLite,
  hdtime: hdtimeLite,
  sjtu: sjtuLite
};

export function getCurrentSite() {
  return siteMap[config.site];
}
