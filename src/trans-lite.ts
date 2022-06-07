
import axios from 'axios';
import { DiskSpace } from 'check-disk-space';
import * as url from 'url';
import * as _ from 'lodash';
import * as log from './log';
import * as transmission from './transmission';
import { TFileItem, TNetUsage, TPTServer } from './types';

export async function get(uid: string, site: string, serverId: number): Promise<TFileItem[]> {
  log.log(`[TransLite] get uid: [${uid}], site: [${site}] serverId: [${serverId}]`);
  const res: TFileItem[] = await doRequest(serverId, 'allFileItem', {
    uid, site
  });
  return res;
}

export async function active(uid: string, site: string, serverId: number): Promise<TFileItem[]> {
  log.log(`[TransLite] active uid: [${uid}], site: [${site}] serverId: [${serverId}]`);
  const activeItem: TFileItem[] = [];
  try {
    const res: TFileItem[] = await doRequest(serverId, 'allFileItem', {
      uid, site
    });
    for (const item of res) {
      if (false === item.downloaded) {
        activeItem.push(item);
      }
    }
  } catch (e) {
    log.message(`[ERROR] [TransLite] active : [${uid}], site: [${site}], serverId: [${serverId}], message: [${e.message}]`);
  }
  return activeItem;
}

export async function freeSpace(uid: string, site: string, serverId: number, folder: string): Promise<{"size-bytes": number}> {
  log.log(`[TransLite] freeSpace uid: [${uid}], site: [${site}] serverId: [${serverId}], folder: [${folder}]`);
  let res: DiskSpace = null;
  try {
    res= await doRequest(serverId, 'freeSpace', {
      uid, site, folder
    });
  } catch (e) {
    log.message(`[ERROR] [TransLite] freeSpace : [${uid}], site: [${site}], serverId: [${serverId}], message: [${e.message}]`);
  }
  return {
    "size-bytes": _.get(res, 'free', -1)
  }
}

export async function removeItem(uid: string, site: string, serverId: number, siteId: string): Promise<void> {
  log.log(`[TransLite] removeItem uid: [${uid}], site: [${site}] serverId: [${serverId}]`);
  try {
    await doRequest(serverId, 'remove', {
      uid, site, siteId
    });
  } catch (e) {
    log.message(`[ERROR] [TransLite] removeItem, uid: [${uid}], site: [${site}], serverId: [${serverId}], message: [${e.message}]`);
  }
}

export async function netSpeed(serverId: number): Promise<{downloadSpeed: number; uploadSpeed: number}> {
  log.log(`[TransLite] netSpeed, serverId: [${serverId}]`);
  let res = {
    downloadSpeed: 0,
    uploadSpeed: 0
  };
  try {
    res = await doRequest(serverId, 'getNetSpeed', {});
  } catch (e) {
    log.message(`[ERROR] [TransLite] netSpeed, serverId: [${serverId}], message: [${e.message}]`);
  }
  return res;
}

async function doRequest(serverId: number, method: string, params): Promise<any> {
  const server: TPTServer = transmission.getServerConfig(serverId);
  const { agentPort, ip } = server;
  const requestUrl: string = url.format({
    protocol: 'http',
    hostname: ip,
    port: agentPort,
    pathname: '/rpc'
  });

  log.log(`[TransList] do request with url: [${requestUrl}], method: [${method}], data: [${JSON.stringify(params)}]`);
  const res = await axios.post(requestUrl, {
    method,
    data: params
  }, {
    responseType: 'json'
  });
  const { success, message, data } = res.data;
  if (false === success) {
    log.log(`request url [${requestUrl}], data: [${JSON.stringify(params)}]  with error: [${message}]`);
    throw new Error(message);
  }
  return data;
}

