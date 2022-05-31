
import axios from 'axios';
import { DiskSpace } from 'check-disk-space';
import * as url from 'url';
import * as log from './log';
import * as transmission from './transmission';
import { TFileItem, TPTServer } from './types';

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
  const res: TFileItem[] = await doRequest(serverId, 'allFileItem', {
    uid, site
  });
  for (const item of res) {
    if (false === item.downloaded) {
      activeItem.push(item);
    }
  }
  return activeItem;
}

export async function freeSpace(uid: string, site: string, serverId: number, folder: string): Promise<{"size-bytes": number}> {
  log.log(`[TransLite] freeSpace uid: [${uid}], site: [${site}] serverId: [${serverId}], folder: [${folder}]`);
  const res: DiskSpace = await doRequest(serverId, 'freeSpace', {
    uid, site, folder
  });
  return {
    "size-bytes": res.free
  }
}

export async function removeItem(uid: string, site: string, serverId: number, siteId: string): Promise<void> {
  log.log(`[TransLite] removeItem uid: [${uid}], site: [${site}] serverId: [${serverId}]`);
  await doRequest(serverId, 'remove', {
    uid, site, siteId
  });
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
