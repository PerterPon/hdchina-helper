

export interface TPageUserInfo {
  shareRatio: string;
  uploadCount: string;
  downloadCount: string;
  magicPoint: string;
  nickname?: string;
  uid?: string;
}

import * as hdchina from './hdchina';
import * as mteam from './mteam'
import * as mteamLite from './mteam-lite';
import * as hdtimeLite from './hdtime-lite';
import * as hdchinaLite from './hdchina-lite';
import * as sjtuLite from './sjtu-lite'
import * as config from '../config';
import * as audiencesLite from './audiences-lite';
import * as ourbitsLite from './ourbits-lite';
import * as pterclubLite from './pterclub-lite';
import * as pttimeLite from './pttime-lite';
import * as hdareaLite from './hdarea-lite';

export const siteMap = {
  hdchina: hdchina,
  mteam: mteamLite,
  hdtime: hdtimeLite,
  sjtu: sjtuLite,
  audiences: audiencesLite,
  ourbits: ourbitsLite,
  pterclub: pterclubLite,
  pttime: pttimeLite,
  hdarea: hdareaLite
};

export function getCurrentSite(site?: string) {
  return siteMap[site || config.site];
}
