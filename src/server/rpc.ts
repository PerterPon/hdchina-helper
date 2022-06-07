
const macAddress = require('macaddress');
import * as path from 'path';
import * as fs from 'fs-extra';
import * as _ from 'lodash';
import checkDiskSpace, { DiskSpace } from 'check-disk-space';

import { getCurrentServerInfo } from './basic';

import { TFileItem, TNetUsage, TPTServer } from "../types";
import { displayTime, parseProcNet, sleep } from '../utils';
import { Dirent } from 'fs';

const SPEED_MONITOR_INTERVAL = 5;

export async function init(): Promise<void> {
  // serverInfo = await getCurrentServerInfo();
}

export async function remove(params) {
  const serverInfo = await getCurrentServerInfo();
  const { uid, siteId, site } = params;
  const { fileDownloadPath } = serverInfo;
  const filePath: string = path.join(fileDownloadPath, site, uid, siteId);
  try {
    console.log(`removing file: [${filePath}]`);
    fs.removeSync(filePath);
  } catch(e) {
    console.log(`[${displayTime()}] remove params: [${JSON.stringify(params)}]`);
    console.log(e);
  }
}

export async function allFileItem(params) {
  const serverInfo = await getCurrentServerInfo();
  const { uid, site } = params;
  const { fileDownloadPath } = serverInfo;
  const userFolder = path.join(fileDownloadPath, site, uid);
  if (false === fs.pathExistsSync(userFolder)) {
    return [];
  }

  const fileItems: TFileItem[] = allFile(userFolder);
  return fileItems;
}

export async function freeSpace(params) {
  const serverInfo = await getCurrentServerInfo();
  const { fileDownloadPath } = serverInfo;
  const { site, uid } = params;
  const targetFolder = path.join(fileDownloadPath, site, uid);
  const checkRes: DiskSpace = await checkDiskSpace(targetFolder);
  return checkRes;
}

export async function getNetSpeed(params) {
  if (2 > receiveArr.length) {
    return {
      uploadSpeed: 0,
      downloadSpeed: 0
    }
  }
  const firstReceive: number = receiveArr[0];
  const latestReceive: number = receiveArr[receiveArr.length - 1];

  const firstSend: number = sendArr[0];
  const latestSend: number = sendArr[sendArr.length - 1];

  const downloadSpeed: number = ( latestReceive - firstReceive ) / ( receiveArr.length * SPEED_MONITOR_INTERVAL );
  const uploadSpeed: number = ( latestSend - firstSend ) / ( sendArr.length * SPEED_MONITOR_INTERVAL );
  return { downloadSpeed, uploadSpeed };
}

const receiveArr: number[] = []
const sendArr: number[] = [];

export async function startWatchNetSpeed(): Promise<void> {
  while (true) {
    await sleep(SPEED_MONITOR_INTERVAL * 1000);
    const netInfo: TNetUsage = parseProcNet();
    receiveArr.push(netInfo.receive);
    if (receiveArr.length > 100) {
      receiveArr.unshift();
    }

    sendArr.push(netInfo.send);
    if (sendArr.length > 100) {
      sendArr.unshift();
    }
  }
}

function allFile(folder: string): TFileItem[] {
  const downloadItems: TFileItem[] = [];
  const files: Dirent[] = fs.readdirSync(folder, { withFileTypes: true });
  for (const file of files) {
    if (false === file.isDirectory()) {
      continue;
    }
    const fileFolder: string = path.join(folder, file.name);
    const isParted: boolean = searchFolderForParted(fileFolder);
    const fileStat = fs.statSync(fileFolder);
    downloadItems.push({
      downloaded: false === isParted,
      siteId: file.name,
      createTime: fileStat.birthtimeMs
    });
  }

  return downloadItems;
}

function searchFolderForParted(folder: string): boolean {
  const files: Dirent[] = fs.readdirSync(folder, {
    withFileTypes: true
  });

  for (const file of files) {
    if (true === file.isDirectory()) {
      const nextFolder = path.join(folder, file.name);
      const result = searchFolderForParted(nextFolder);
      if (true === result) {
        return result;
      }
    } else {
      if (true === /\.part$/.test(file.name)) {
        return true
      }
    }
  }
  return false;
}
