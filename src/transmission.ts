
const Transmission = require('transmission');
import * as _ from 'lodash';
import * as path from 'path';
import { promisify } from 'util';
import * as config from './config';
import * as log from './log';
import * as filesize from 'filesize';
import * as mysql from './mysql';
import * as transLite from './trans-lite';
const Qbittorrent = require('@electorrent/node-qbittorrent');

import * as utils from './utils';

import { ETransmissionStatus, TFileItem, TItem, TNetUsage, TPTServer, TQbitTorrent, TTransmission } from './types';

export interface TTransItem1 {
  id: number;
  downloadDir: string;
  name: string;
  hash: string;
  status: number;
  size: number;
  activityDate: Date;
  isFinished: boolean;
  serverId: number;
  siteId: string;
}

export let servers: TPTServer[] = [];
export const serverConfigMap: Map<number, TPTServer> = new Map();
const serverMap: Map<number, TTransmission | TQbitTorrent> = new Map();

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
    const { id, ip, port, username, password, box, type } = server;
    
    let transmissionClient = null;
    if ('transmission' === type) {
      transmissionClient = new Transmission({
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
    } else {
      const Qbittorrent = QBittorrent;
      transmissionClient = new Qbittorrent({
        host: ip,
        port,
        user: username,
        pass: password
      });
      transmissionClient.login = promisify(transmissionClient.login);
      transmissionClient.addTorrentFileContent = promisify(transmissionClient.addTorrentFileContent);
      transmissionClient.deleteAndRemove = promisify(transmissionClient.deleteAndRemove);
      await transmissionClient.login();
    }

    serverMap.set(id, transmissionClient);
    downloadingServer.push(server.ip);
    log.log(`[Transmission] init server success! : [${id}], type: [${type}]`);
  }

  log.message(`downloading server: [${downloadingServer}]`);
}

export async function getDownloadingItems(serverId: number = -1): Promise<TItem[]> {
  log.log(`[Transmission] getDownloadingItems, serverId: [${serverId}]`);

  if (-1 !== serverId) {
    return getServerItems(serverId, 'active');
  }

  const downloadingItems: TItem[] = [];
  const mapArr = Array.from(serverMap);
  if (-1 === serverId) {
    for (const itemArr of mapArr) {
      const currentServerId: number = itemArr[0];
      const items = await getServerItems(currentServerId, 'active');
      downloadingItems.push(...items);
    }
  }

  return downloadingItems;
}

export async function getAllItems(serverId: number = -1, ids: number[] = []): Promise<TItem[]> {
  log.log(`[Transmission] getAllItems, serverId: [${serverId}] ids: [${ids}]`);

  if (-1 !== serverId) {
    return getServerItems(serverId, 'all', ids);
  }

  const downloadingItems: TItem[] = [];
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

async function getServerItems(serverId: number, type: 'all'|'active', ids?: number[]): Promise<TItem[]> {
  log.log(`[Transmission] getServerItems serverId: [${serverId}], type: [${type}], ids: [${ids}]`);
  const targetItem: TItem[] = [];
  // const server = getServer(serverId);
  let data = {
    torrents: []
  };

  const { uid, site } = config.userInfo;
  const allFileItem: TFileItem[] = await transLite.get(uid, site, serverId);
  const fileItemMap = {};
  for (const item of allFileItem) {
    fileItemMap[item.siteId] = item;
  }

  const siteIds: string[] = _.map(allFileItem, 'siteId');
  
  const allItem: TItem[] = await mysql.getItemBySiteIds(uid, site, siteIds);
  for (const item of allItem) {
    const fileItem = fileItemMap[item.id];
    if (undefined === fileItem) {
      continue;
    }
    const { downloaded, activityDate } = fileItem;
    item.finished = downloaded;
    item.activeDate = activityDate;
    if ('all' === type || (false === downloaded && 'active' === type)) {
      targetItem.push(item);
    }
  }

  return targetItem;
}

export async function removeItem(id: string, siteId: string, serverId: number): Promise<void> {
  log.log(`[Transmission] remove item: [${id}], siteId: [${siteId}], serverId: [${serverId}]`);

  const { uid, site } = config.userInfo;
  await transLite.removeItem(uid, site, serverId, siteId);

  let result = null;

  // try to remove from transmission
  try {
    const server = getServer(serverId) as TTransmission;
    const removeFunc = server.remove(id, true);
    result = await utils.timeout(
      removeFunc,
      60 * 1000,
      `[Transmission] removeItem timeout! id: [${id}], siteId: [${siteId}], serverId: [${serverId}]`
    );
  } catch (e) {

  }

  // try to remove from qbittorrent
  try {
    const server = getServer(serverId) as TQbitTorrent;
    const removeFunc = server.deleteAndRemove(id);
    result = await utils.timeout(
      removeFunc,
      60 * 1000,
      `[Transmission] removeItem timeout! id: [${id}], siteId: [${siteId}], serverId: [${serverId}]`
    );
  } catch (e) {

  }

  log.log(`[Transmission] remove item: [${id}] with result: [${JSON.stringify(result)}]`);
}

export async function addTorrent(content: Buffer, serverId: number, fileId: string, torrentHash: string): Promise<{transId: string; hash: string; serverId: number;}> {
  const serverConfig = getServerConfig(serverId);
  log.log(`[Transmission] add base64content: [${content.length}], server id: [${serverId}], download dir: [${serverConfig.fileDownloadPath}]`);

  const curFileDownloadPath: string = path.join(serverConfig.fileDownloadPath, fileId);
  if ('transmission' === serverConfig.type) {
    return await addFileToTransmission(content, serverConfig, curFileDownloadPath, torrentHash);
  } else if ('qbittorrent' === serverConfig.type) {
    return await addFileToQbittorrent(content, serverConfig, curFileDownloadPath, torrentHash);
  }
  return null;
}

async function addFileToTransmission(content: Buffer, serverInfo: TPTServer, savePath: string, torrentHash: string): Promise<{transId: string; hash: string; serverId: number;}> {
  log.log(`[Transmission] addFileToTransmission, content: [${content.length}], serverInfo: [${serverInfo.id}], savePath: [${savePath}]`);

  const base64Content: string = content.toString('base64');
  const server = getServer(serverInfo.id) as TTransmission;
  const addFunc = server.addBase64(base64Content, {
    'download-dir': savePath
  });
  const res = await utils.timeout(
    addFunc,
    60 * 1000,
    `[Transmission] addBase64 timeout! content: [${base64Content.length}], serverId: [${serverInfo.id}], savePath: [${savePath}]`
  );
  log.log(`[Transmission] add url with result: [${JSON.stringify(res)}]`);
  const { id, hashString } = res;
  return {
    transId: id,
    hash: hashString,
    serverId: serverInfo.id
  };
}

async function addFileToQbittorrent(content: Buffer, serverInfo: TPTServer, savePath: string, torrentHash: string): Promise<{transId: string; hash: string; serverId: number;}> {
  log.log(`[Transmission] addFileToQbittorrent, content: [${content.length}], serverInfo: [${serverInfo.id}], savePath: [${savePath}]`);
  const server = getServer(serverInfo.id) as TQbitTorrent;
  const addFunc = server.addTorrentFileContent(content, torrentHash, {
    savepath: savePath
  });
  const res = await utils.timeout(
    addFunc,
    60 * 1000,
    `[Transmission] addFileToQbittorrent timeout! content: [${content.length}], serverId: [${serverInfo.id}], savePath: [${savePath}]`
  );
  log.log(`[Transmission] add url with result: [${JSON.stringify(res)}]`);
  return {
    transId: torrentHash,
    hash: torrentHash,
    serverId: serverInfo.id
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

    const { site, uid } = config.userInfo;
    const res = await transLite.freeSpace(uid, site, serverId, oriFileDownloadPath);
    log.message(`server: [${serverInfo.id}], left space total: [${filesize(res['size-bytes'])}]`);
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
  log.log(`[Transmission] sessionStates serverId: [${serverId}]`);
  if (-1 !== serverId) {
    const netSpeed = await transLite.netSpeed(serverId);
    return [{
      serverId,
      uploadSpeed: netSpeed.uploadSpeed,
      downloadSpeed: netSpeed.downloadSpeed
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
    const netSpeed = await transLite.netSpeed(currentServerId);
    resFreeSpaceInfo.push({
      serverId: currentServerId,
      uploadSpeed: netSpeed.uploadSpeed,
      downloadSpeed: netSpeed.downloadSpeed
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

export function getServer(serverId: number): TTransmission | TQbitTorrent {
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
