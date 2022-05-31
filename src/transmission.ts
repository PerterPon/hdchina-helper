
const Transmission = require('transmission');
import * as _ from 'lodash';
import * as path from 'path';
import { promisify } from 'util';
import * as config from './config';
import * as log from './log';
import * as filesize from 'filesize';
import * as mysql from './mysql';
import * as transLite from './trans-lite';

import { ETransmissionStatus, TFileItem, TItem, TPTServer, TTransmission } from './types';

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
  servers = await mysql.getServers(uid, config.userInfo.serverIds);
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
    downloadingServer.push(server.ip);
    log.log(`[Transmission] init server: [${id}]`);
  }

  log.message(`downloading server: [${downloadingServer}]`);
}

export async function filterDownloadingItems(serverId: number, ids: number[]): Promise<TTransItem[]> {
  log.log(`[Transmission] filterDownloadingItems serverId: [${serverId}], ids: [${ids}]`);
  const items: TTransItem[] = await getAllItems(serverId, ids);
  const downloadingItems: TTransItem[] = [];
  for (const item of items) {
    const { status } = item;
    if (-1 < [ETransmissionStatus.SEED_WAIT, ETransmissionStatus.SEED].indexOf(status)) {
      continue;
    }
    downloadingItems.push(item);
  }
  return downloadingItems;
}

export async function getAllItems(serverId: number = -1, ids: number[] = []): Promise<TTransItem[]> {
  log.log(`[Transmission] getAllItems, serverId: [${serverId}] ids: [${ids}]`);

  if (-1 !== serverId) {
    return getServerItems(serverId, 'all', ids);
  }

  const downloadingItems: TTransItem[] = [];
  const mapArr = Array.from(serverMap);
  if (-1 === serverId) {
    for (const itemArr of mapArr) {
      const currentServerId: number = itemArr[0];
      const items = await getServerItems(currentServerId, 'all', ids);
      downloadingItems.push(...items);
    }
  }

  return downloadingItems;
}

async function getServerItems(serverId: number, type: 'all'|'active', ids?: number[]): Promise<TTransItem[]> {
  log.log(`[Transmission] getServerItems serverId: [${serverId}], type: [${type}], ids: [${ids}]`);
  const downloadingItems: TTransItem[] = [];
  // const server = getServer(serverId);
  let data = {
    torrents: []
  };

  const { uid, site } = config.userInfo;
  const allFileItem: TFileItem[] = await transLite.get(uid, site, serverId);
  const siteIds: string[] = _.map(allFileItem, 'siteId');

  const allItem: TItem[] = await mysql.getItemBySiteIds(uid, site, siteIds);
  const itemMap: Map<string ,TItem> = new Map();
  for (const item of allItem) {
    const { id } = item;
    itemMap.set(id, item);
  }

  for (const fileItem of allFileItem) {
    const { siteId, downloaded } = fileItem;
    const item = itemMap.get(siteId);
    if (undefined === item) {
      continue;
    }
    if ('active' === type && true === downloaded) {
      continue;
    }
    downloadingItems.push({
      id: item.transId,
      name: item.title,
      downloadDir: '',
      status: true === fileItem.downloaded ? 6 : 4,
      size: item.size,
      activityDate: new Date(fileItem.createTime),
      isFinished: fileItem.downloaded,
      serverId: item.serverId,
      hash: item.torrentUrl
    });
  }

  // if ('all' === type) {
  //   // data = await server.get(ids);
  // } else if ('active' === type) {
  //   // data = await server.active();
  // }
  // for (const item of data.torrents) {
  //   const { status, id, name, downloadDir, hashString, sizeWhenDone: size, activityDate, isFinished } = item;
  //   downloadingItems.push({
  //     id, name, downloadDir, status, size, activityDate, isFinished, serverId,
  //     hash: hashString
  //   });
  // }
  return downloadingItems;
}

export async function removeItem(id: number, siteId: string, serverId: number): Promise<void> {
  log.log(`[Transmission] remove item: [${id}] serverId: [${serverId}]`);
  const server = getServer(serverId);

  const { uid, site } = config.userInfo;
  await transLite.removeItem(uid, site, serverId, siteId);
  const result = await server.remove(id, true);
  log.log(`[Transmission] remove item: [${id}] with result: [${JSON.stringify(result)}]`);
}

export async function addUrl(url: string, serverId: number, fileId: string): Promise<{transId: string; hash: string; serverId: number;}> {
  const server = getServer(serverId);
  const serverConfig = getServerConfig(serverId);
  log.log(`[Transmission] add url: [${url}], server id: [${serverId}], download dir: [${serverConfig.fileDownloadPath}]`);
  const curFileDownloadPath: string = path.join(serverConfig.fileDownloadPath, fileId);
  const res = await server.addUrl(url, {
    'download-dir': curFileDownloadPath
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

    // const serverClient = getServer(serverId);
    // const res = await serverClient.freeSpace(oriFileDownloadPath);
    const { site, uid } = config.userInfo;
    const res = await transLite.freeSpace(uid, site, serverId, oriFileDownloadPath);
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
  log.log(`[Puppeteer] sessionStates serverId: [${serverId}]`);
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
      serverId: currentServerId,
      uploadSpeed: res.uploadSpeed,
      downloadSpeed: res.downloadSpeed
    });
  }
  return resFreeSpaceInfo;
}

export async function canAddServers(vip: boolean): Promise<number[]> {
  log.log(`[Puppeteer] canAddServers vip: [${vip}]`);
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

export function getServer(serverId: number): TTransmission {
  log.log(`[Puppeteer] getServer serverId: [${serverId}]`);
  const server = serverMap.get(serverId);
  if (undefined === server) {
    throw new Error(`trying to get server with server id: [${serverId}], but server not found!`);
  }
  return server;
}

export function getServerConfig(serverId: number): TPTServer {
  log.log(`[Puppeteer] getServerConfig serverId: [${serverId}]`);
  const server = serverConfigMap.get(serverId);
  if (undefined === server) {
    throw new Error(`trying to get server config with server id: [${serverId}], but server not found!`);
  }
  return server;
}

export const status: any = {};
