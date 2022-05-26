
const Transmission = require('transmission');
import * as _ from 'lodash';
import { promisify } from 'util';
import * as config from './config';
import * as log from './log';
import * as filesize from 'filesize';
import * as mysql from './mysql';

import { TPTServer, TTransmission } from './types';

export interface TTransItem {
  id: number;
  downloadDir: string;
  name: string;
  hash: string;
  status: number;
  size: number;
  activityDate: Date;
  isFinished: boolean;
  serverId: number;
}

export let servers: TPTServer[] = [];
export const serverConfigMap: Map<number, TPTServer> = new Map();
const serverMap: Map<number, TTransmission> = new Map();

export async function init(uid: string): Promise<void> {
  if (servers.length > 0) {
    return;
  }

  await initServerInfo(uid);
  await initServer();
}

async function initServerInfo(uid: string): Promise<void> {
  log.log(`[Transmission] initServerInfo`);
  servers = await mysql.getServers(uid);
  for (const server of servers) {
    const { id } = server;
    serverConfigMap.set(id, server);
    server.fileDownloadPath = `${server.fileDownloadPath}/${config.site}/${config.uid}`;
  }
}

async function initServer(): Promise<void> {
  log.log(`[Transmission] initServer`);
  let downloadingServer: string[] = [];
  for (const server of servers) {
    const { id, ip, port, username, password, box } = server;

    const transmissionClient = new Transmission({
      host: ip,
      ssl: false,
      port, username, password
    });
    Object.assign(status, transmissionClient.status);
    for (const fnName in transmissionClient) {
      const fn = transmissionClient[fnName];
      if (true === _.isFunction(fn)) {
        transmissionClient[fnName] = promisify(fn);
      }
    }

    serverMap.set(id, transmissionClient);

    const activeItem = await getServerItems(id, 'active');
    server.activeNumber = activeItem.length;
    downloadingServer.push(server.ip);
    log.log(`[Transmission] init server: [${id}], active number: [${server.activeNumber}]`);
  }

  log.message(`downloading server: [${downloadingServer}]`);
}

export async function getDownloadingItems(serverId: number = -1): Promise<TTransItem[]> {
  log.log(`[Transmission] get download items with server id: [${serverId}]`);

  if (-1 !== serverId) {
    return getServerItems(serverId, 'active');
  }

  const downloadingItems: TTransItem[] = [];
  const mapArr = Array.from(serverMap);
  for (const itemArr of mapArr) {
    const currentServerId: number = itemArr[0];
    const items = await getServerItems(currentServerId, 'active');
    downloadingItems.push(...items);
  }

  return downloadingItems;
}

export async function getAllItems(serverId: number = -1): Promise<TTransItem[]> {
  log.log(`[Transmission] getAllItems`);

  if (-1 !== serverId) {
    return getServerItems(serverId, 'all');
  }

  const downloadingItems: TTransItem[] = [];
  const mapArr = Array.from(serverMap);
  if (-1 === serverId) {
    for (const itemArr of mapArr) {
      const currentServerId: number = itemArr[0];
      const items = await getServerItems(currentServerId, 'all');
      downloadingItems.push(...items);
    }
  }

  return downloadingItems;
}

async function getServerItems(serverId: number, type: 'all'|'active'): Promise<TTransItem[]> {
  const downloadingItems: TTransItem[] = [];
    
  const server = getServer(serverId);
  let data = {
    torrents: []
  };
  if ('all' === type) {
    data = await server.get();
  } else if ('active' === type) {
    data = await server.active();
  }
  for (const item of data.torrents) {
    const { status, id, name, downloadDir, hashString, sizeWhenDone: size, activityDate, isFinished } = item;
    downloadingItems.push({
      id, name, downloadDir, status, size, activityDate, isFinished, serverId,
      hash: hashString
    });
  }
  return downloadingItems;
}

export async function removeItem(id: number, serverId: number): Promise<void> {
  log.log(`[Transmission] remove item: [${id}]`);
  const server = getServer(serverId);

  const result = await server.remove(id, true);
  log.log(`[Transmission] remove item: [${id}] with result: [${JSON.stringify(result)}]`);
}

export async function addUrl(url: string, serverId: number): Promise<{transId: string; hash: string; serverId: number;}> {
  const server = getServer(serverId);
  const serverConfig = getServerConfig(serverId);
  log.log(`[Transmission] add url: [${url}], server id: [${serverId}], download dir: [${serverConfig.fileDownloadPath}]`);
  const res = await server.addUrl(url, {
    'download-dir': serverConfig.fileDownloadPath
  });
  log.log(`[Transmission] add url with result: [${JSON.stringify(res)}]`);
  const { id, hashString } = res;
  return {
    transId: id,
    hash: hashString,
    serverId
  };
}

export async function freeSpace(serverId: number = -1): Promise<{serverId: number; size: number;}[]> {
  if (-1 !== serverId) {
    return getFreeSpace(serverId);
  }

  const freeSpaceInfo = [];
  const mapArr = Array.from(serverMap);
  for (const itemArr of mapArr) {
    const [currentServerId, server] = itemArr;
    const info = await getFreeSpace(currentServerId);
    freeSpaceInfo.push(...info);
  }

  async function getFreeSpace(serverId: number): Promise<{serverId: number; size: number}[]> {
    const serverInfo: TPTServer = getServerConfig(serverId);
    const { oriFileDownloadPath } = serverInfo;
    log.log(`[Transmission] getFreeSpace server id: [${serverId}], fileDownloadPath: [${oriFileDownloadPath}]`);

    const serverClient = getServer(serverId);
    const res = await serverClient.freeSpace(oriFileDownloadPath);
    log.message(`left space total: [${filesize(res['size-bytes'])}]`);
    log.log(`[Transmission] free space: [${oriFileDownloadPath}], total: [${filesize(res['size-bytes'])}]`);
    return [{
      serverId,
      size: res['size-bytes']
    }]
  }

  return freeSpaceInfo;
}

export async function sessionStates(serverId: number = -1): Promise<{
  uploadSpeed: number,
  downloadSpeed: number,
  serverId: number
}[]> {
  if (-1 !== serverId) {
    const server = getServer(serverId);
    const res = await server.sessionStats();
    return [{
      serverId,
      uploadSpeed: res.uploadSpeed,
      downloadSpeed: res.downloadSpeed
    }]
  }

  const resFreeSpaceInfo:{
    uploadSpeed: number,
    downloadSpeed: number,
    serverId: number
  }[] = [];
  const mapArr = Array.from(serverMap);
  for (const itemArr of mapArr) {
    const [currentServerId, server] = itemArr;
    const res = await server.sessionStats();
    resFreeSpaceInfo.push({
      serverId,
      uploadSpeed: res.uploadSpeed,
      downloadSpeed: res.downloadSpeed
    });
  }
  return resFreeSpaceInfo;
}

export async function canAddServers(vip: boolean): Promise<number[]> {
  const canAddServerIds: number[] = [];
  for (const server of servers) {
    const { box, id } = server;
    if (
      ( true === box && false === vip ) ||
      ( false === box && true === vip )
    ) {
      continue;
    }
    canAddServerIds.push(id);

  }
  return canAddServerIds;
}

function getServer(serverId: number): TTransmission {
  const server = serverMap.get(serverId);
  if (undefined === server) {
    throw new Error(`trying to get server with server id: [${serverId}], but server not found!`);
  }
  return server;
}

function getServerConfig(serverId: number): TPTServer {
  const server = serverConfigMap.get(serverId);
  if (undefined === server) {
    throw new Error(`trying to get server config with server id: [${serverId}], but server not found!`);
  }
  return server;
}

export const status: any = {};
