

export interface TPageUserInfo {
  shareRatio: string;
  uploadCount: string;
  downloadCount: string;
  magicPoint: string;
}

import * as hdchina from './hdchina';
import * as mteam from './mteam'
import * as mteamLite from './mteam-lite';

export const siteMap = {
  hdchina,
  mteam,
  mteamLite
};
