
import * as mysql from '../mysql';
import * as utils from '../utils';

import { exec } from 'child_process';

import { getCurrentServerInfo } from './basic';

import { TPTServer, TPTUserInfo } from '../types';

export async function getCrontab(): Promise<any>{
  const crontabs: string[] = await utils.parseCrontab();
  return crontabs.join('\n');
}

export async function setCrontab(params): Promise<any> {
  const { uid, site } = params;
  const userInfo: TPTUserInfo = await mysql.getUserInfoByQuery({uid, site});
  const { cycleTime, nickname, site: userSite } = userInfo;
  const crontabs: string[] = await utils.parseCrontab();
  let existsIndex: number = -1;
  const serverInfo: TPTServer = await getCurrentServerInfo();

  const crontabTask: string = `*/${cycleTime} *   * * *   root    ${serverInfo.nodeAddr} ${serverInfo.projAddr}/build/src/scraper.js --site=${site} --nickname=${userInfo.nickname}`;

  for (let i = 0; i < crontabs.length; i++) {
    const crontab: string = crontabs[i];
    if (-1 < crontab.indexOf(nickname) && -1 < crontab.indexOf(userSite)) {
      existsIndex = i;
      break;
    }
  }

  if (-1 === existsIndex) {
    crontabs.push(crontabTask);
    crontabs.push('\n');
  } else {
    crontabs[existsIndex] = crontabTask;
  }
  const newContent = await utils.setCrontab(crontabs);
  return newContent;
}

export async function deleteCrontab(params): Promise<any> {
  const { uid, site } = params;
  const userInfo: TPTUserInfo = await mysql.getUserInfoByQuery({uid, site});
  const { nickname, site: userSite } = userInfo;
  const crontabs: string[] = await utils.parseCrontab();
  let existsIndex: number = -1;

  for (let i = 0; i < crontabs.length; i++) {
    const crontab: string = crontabs[i];
    if (-1 < crontab.indexOf(nickname) && -1 < crontab.indexOf(userSite)) {
      crontabs[i] = '';
      break;
    }
  }
  const newContent = await utils.setCrontab(crontabs);
  return newContent;
}

export async function deploy(): Promise<any> {
  const serverInfo: TPTServer = await getCurrentServerInfo();
  const { projAddr } = serverInfo;
  let res = null;
  try {
    const command: string = `cd ${projAddr} && git checkout . && git pull origin master && npm install && echo "git pull origin master" && rm -rf ./build && ${projAddr}/node_modules/.bin/tsc && echo "tsc" && cp -r etc build && cp version build && echo "restart" && pm2 restart all`;
    exec(command)
  } catch (e) {
    console.log(e);
    res = e;
  }
  return 'beginning';
}
