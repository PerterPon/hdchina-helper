
import { TPTServer, TPTUserInfo } from '../types';
import { callRemoteServer } from '../server/basic';
import * as mysql from '../mysql';
import * as puppeLite from '../puppe-lite';
import * as config from '../config';
import { TPageUserInfo } from 'src/sites/basic';

export async function init(): Promise<void> {

}

export async function deleteScraper(params): Promise<void> {
  const { uid, site } = params;
  const userInfo: TPTUserInfo = await mysql.getUserInfoByQuery({
    uid, site
  });
  const serverInfo: TPTServer[] = await mysql.getAllServers([userInfo.scraperServer]);
  if (0 === serverInfo.length) {
    console.log(`can not found user: [${uid}] scraper server: [${userInfo.scraperServer}]`);
    return;
  }

  await callRemoteServer(serverInfo[0], 'deleteCrontab', { uid, site });

  await mysql.updateUser({
    scraper_server: null
  }, {
    uid, site
  });
}

export async function updateScraper(params): Promise<void> {
  const { uid, site, serverId } = params;
  const userInfo: TPTUserInfo = await mysql.getUserInfoByQuery({ uid, site });

  try {
    const nowServer: TPTServer = await findServer(userInfo.scraperServer);
    await callRemoteServer(nowServer, 'deleteCrontab', { uid, site });
  } catch (e) {}
  if (-1 === Number(serverId)) {
    return;
  }

  const targetServer: TPTServer = await findServer(serverId);

  await callRemoteServer(targetServer, 'setCrontab', { uid, site });

  await mysql.updateUser({
    scraper_server: serverId
  }, {
    uid, site
  });
}

export async function deleteUser(params): Promise<void> {
  const { uid, site } = params;
  const allServer: TPTServer[] = await mysql.getAllServers();
  for (const server of allServer) {
    const res = await callRemoteServer(server, 'deleteUser', { uid, site });
    console.log(`delete user: [${uid}], site: [${site}] from server: [${server.ip}] with result: [${JSON.stringify(res)}]`);
  }
}

export async function addUser(params): Promise<void> {
  await mysql.addUser(params);
  const { cookie, site } = params;
  const userInfo: TPageUserInfo = await getUserInfoBySiteAndCookie(cookie, site);
  await mysql.updateUser({
    nickname: userInfo.nickname,
    uid: userInfo.uid
  }, {
    cookie
  });
}

async function getUserInfoBySiteAndCookie(cookie: string, site: string): Promise<TPageUserInfo> {
  await puppeLite.init(site);
  const configInfo = config.getConfig(site);
  const userInfo: TPageUserInfo = await puppeLite.getUserInfo(configInfo.indexPage, cookie);
  return userInfo;
}

async function findServer(serverId: number): Promise<TPTServer> {
  const server: TPTServer[] = await mysql.getAllServers([serverId]);
  if (0 === server.length) {
    throw new Error("can not found server: [${serverId}]");
  }
  return server[0];
}