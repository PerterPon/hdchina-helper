
const macAddress = require('macaddress');
import * as path from 'path';
import * as fs from 'fs-extra';
import * as _ from 'lodash';
import checkDiskSpace, { DiskSpace } from 'check-disk-space';

import * as mysql from '../mysql';

import { TFileItem, TPTServer } from "../types";
import { displayTime } from '../utils';
import { Dirent } from 'fs';

// let serverInfo: TPTServer = null;

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
  const serverInfo = await getCurrentServerInfo();
}

async function getCurrentServerInfo(): Promise<TPTServer> {
  const macs = await macAddress.all();
  const servers: TPTServer[] = await mysql.getAllServers();
  for (const interfaceName in macs) {
    const { mac } = macs[interfaceName];
    for (const server of servers) {
      const { macAddress } = server;
      if (true === _.isString(macAddress) && 0 < macAddress.length && mac === macAddress) {
        return server;
      }
    }
  }

  return null;
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
      if (true === /\.parted$/.test(file.name)) {
        console.log(file.name);
        return true
      }
    }
  }
  return false;
}
