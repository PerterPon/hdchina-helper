
import * as mysql from '../mysql';
import * as utils from '../utils';

import * as shellJs from 'shelljs';
import { execSync } from 'child_process';

import { getCurrentServerInfo } from './basic';

import { TPTServer, TPTUserInfo } from '../types';

export async function setCrontab(params): Promise<any> {
  const { uid, site } = params;
  const userInfo: TPTUserInfo = await mysql.getUserInfoByUid(uid, site);
  const { cycleTime, nickname, site: userSite } = userInfo;
  const crontabs: string[] = await utils.parseCrontab();
  let existsIndex: number = -1;
  const serverInfo: TPTServer = await getCurrentServerInfo();

  const crontabTask: string = `*/${cycleTime} *   * * *   root    ${serverInfo.nvmAddr}/versions/node/v14.19.1/bin/node ${serverInfo.projAddr}/build/src/scraper.js --site=${site} --nickname=${userInfo.nickname}`;

  for (let i = 0; i < crontabs.length; i++) {
    const crontab: string = crontabs[i];
    if (-1 < crontab.indexOf(nickname) && -1 < crontab.indexOf(userSite)) {
      existsIndex = i;
      break;
    }
  }

  if (-1 === existsIndex) {
    crontabs.push(crontabTask);
  } else {
    crontabs[existsIndex] = crontabTask;
  }
  const newContent = await utils.setCrontab(crontabs);
  return newContent;
}

export async function deleteCrontab(params): Promise<any> {
  const { uid, site } = params;
  const userInfo: TPTUserInfo = await mysql.getUserInfoByUid(uid, site);
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
    const command: string = `cd ${projAddr} && git pull origin master && rm -rf ./build && ./node_module/.bin/tsc && cp -r etc build && cp version build && pm2 restart all`;
    execSync(command);
    // shellJs.cd(projAddr);
    // const code = shellJs.exec(command).code;
    // if (code !== 0) {
    //   throw new Error(`exec failed, code: [${code}]`);
    // }
  } catch (e) {
    console.log(e);
  }
  return res;
}
