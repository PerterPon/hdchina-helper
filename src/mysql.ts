
import * as mysql from 'mysql2/promise';
import { TItem, TSiteData } from './types';
import * as config from './config';
import * as _ from 'lodash';
import * as log from './log';

import { TPTUserInfo, TPTServer } from './types';
import { UTF8Time } from './utils';

export let pool: mysql.Pool = null;

export async function init(): Promise<void> {
  log.log(`[Mysql] init`);
  if (null !== pool) {
    return;
  }
  const configInfo = config.getConfig();
  const { host, user, password, database, waitForConnections, connectionLimit, queueLimit } = configInfo.mysql;
  pool = mysql.createPool({
    host, user, password, database, waitForConnections, connectionLimit, queueLimit,
    acquireTimeout: 20000,
    connectTimeout: 20000
  });
}

export async function storeItem(uid: string, site: string, items: TItem[]): Promise<void> {
  log.log(`[Mysql] storeItem uid: [${uid}], items: [${JSON.stringify(items)}]`);
  for (const item of items) {
    const { id, freeUntil, size, title, torrentUrl, free, transHash, publishDate } = item;
    await pool.query(`
    INSERT INTO
      torrents(gmt_create, gmt_modify, uid, site, site_id, size, torrent_url, is_free, free_until, title, publish_date)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      size = VALUES(size),
      torrent_url = VALUES(torrent_url),
      free_until = VALUES(free_until),
      is_free = VALUES(is_free),
      publish_date = VALUES(publish_date);
    `, [UTF8Time(), UTF8Time(), uid, site, id, size, torrentUrl, Number(free), freeUntil, title, publishDate]);
  }
};

export async function getFreeItems(uid: string, site: string): Promise<TItem[]> {
  log.log(`[Mysql] get free item`);
  const [data]: any = await pool.query(`
    SELECT *
    FROM (
      SELECT 
        torrents.site_id AS site_id,
        torrents.site AS site,
        torrents.size AS size,
        torrents.uid AS uid,
        torrents.is_free AS is_free,
        torrents.free_until AS free_until,
        torrents.title AS title,
        torrents.torrent_url AS torrent_url,
        torrents.publish_date as publish_date,
        downloader.id AS downloader_id,
        downloader.server_id AS server_id
      FROM
        torrents
      LEFT JOIN
        downloader
      ON
        torrents.site = downloader.site AND
        torrents.site_id = downloader.site_id AND
        torrents.uid = downloader.uid
      WHERE
        torrents.is_free = 1 AND
        torrents.free_until > ? AND
        torrents.uid = ? AND
        torrents.site = ?
    ) AS temp
    WHERE
      downloader_id IS NULL;
    `, [UTF8Time(), uid, site]);
  log.log(`[Mysql] get free item: [${JSON.stringify(data)}]`);
  const freeItems: TItem[] = [];
  for (const item of data) {
    const { server_id, site_id, uid, site, size, title, is_free, free_until, torrent_url, publish_date } = item;
    freeItems.push({
      id: site_id,
      site,
      uid,
      freeUntil: free_until,
      size, title,
      torrentUrl: torrent_url,
      serverId: server_id,
      publishDate: publish_date,
      free: Boolean(is_free)
    });
  }
  return freeItems;
}

export async function storeDownloadAction(site: string, siteId: string, uid: string, transId: string, torrentHash: string, serverId: number): Promise<void> {
  log.log(`[Mysql] storeDownloadAction site: [${site}], site id: [${siteId}], uid: [${uid}], trans id: [${transId}], torrent hash: [${torrentHash}] server id: [${serverId}]`);
  await pool.query(`
  INSERT INTO downloader(gmt_create, gmt_modify, uid, trans_id, torrent_hash, site, site_id, server_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [UTF8Time(), UTF8Time(), uid, transId, torrentHash, site, siteId, serverId]);
}

export async function updateTorrentHashBySiteAndId(uid: string, site: string ,siteId: string, torrentHash: string): Promise<void> {
  log.log(`[Mysql] updateTorrentHashBySiteAndId, site: [${site}], site id: [${siteId}], torrent hash: [${torrentHash}]`);
  await pool.query(`
  UPDATE
    torrents
  SET
    torrent_hash = ?
  WHERE
    site = ? AND
    site_id = ? AND
    uid = ?;
  `, [torrentHash, site, siteId, uid]);
}

export async function getTransIdByItem(uid: string, items: TItem[]): Promise<number[]> {
  log.log(`[Mysql] getTransIdByItem: [${JSON.stringify(items)}]`);
  if (0 === items.length) {
    return [];
  }
  const itemIds: string[] = [];
  const transIds: number[] = [];
  for (const item of items) {
    const { id } = item;
    itemIds.push(id);
    try {
      const [res] = await pool.query(`
      SELECT
        *
      FROM
        downloader
      WHERE
        site = ? AND 
        site_id = ? AND
        uid = ?;
      `,[item.site, item.id, uid]);
      transIds.push(res[0].trans_id);
    } catch (e) {
      log.log(e.message);
      log.log(e.stack);
    }
  }
  return transIds;
}

export async function getItemByHash(uid: string, site: string, hash: string[]): Promise<TItem[]> {
  log.log(`[Mysql] get item by hash: [${JSON.stringify(hash)}]`);
  if (0 === hash.length) {
    return [];
  }
  const [res]: any = await pool.query(`
  SELECT
    torrents.site_id as site_id,
    torrents.uid as uid,
    torrents.site as site,
    torrents.title as title,
    torrents.size as size,
    torrents.torrent_url as torrent_url,
    torrents.torrent_hash as torrent_hash,
    torrents.free_until as free_until,
    torrents.is_free as is_free,
    torrents.publish_date as publish_date,
    downloader.server_id as server_id
  FROM
    torrents
  LEFT JOIN
    downloader
  ON
    torrents.site = downloader.site AND
    torrents.site_id = downloader.site_id AND
    torrents.uid = downloader.uid
  WHERE
    torrents.uid = ? AND
    torrents.torrent_hash IN (?) AND
    torrents.site = ?;
  `, [uid, hash, site]);
  const items: TItem[] = [];
  for (const item of res) {
    const { site_id, uid, site, is_free, title, size, torrent_url, torrent_hash, free_until, server_id, publish_date } = item;
    items.push({
      size, title,
      id: site_id,
      site: site,
      uid,
      torrentUrl: torrent_url,
      transHash: torrent_hash,
      freeUntil: free_until,
      serverId: server_id,
      publishDate: publish_date,
      free: Boolean(is_free),
    });
  }
  return items;
}

export async function storeSiteInfo(
  uid: string,
  site: string,
  siteData: TSiteData
): Promise<void> {
  const { shareRatio, downloadCount, uploadCount, magicPoint, uploadSpeed, downloadSpeed } = siteData;
  log.log(`[Mysql] store site info, share ratio: [${shareRatio}], download count: [${downloadCount}], upload count: [${uploadCount}], magic point: [${magicPoint}], upload speed: [${uploadSpeed}], download speed: [${downloadSpeed}]`);
  await pool.query(`
  INSERT INTO 
    site_data(gmt_create, gmt_modify, site, uid, share_ratio, download_count, upload_count, magic_point, upload_speed, download_speed)
  VALUE(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [UTF8Time(), UTF8Time(), site, uid, shareRatio || 0, downloadCount || 0, uploadCount || 0, magicPoint || 0, uploadSpeed || 0, downloadSpeed]);
}

export async function getUserInfoByUid1(uid: string, site: string): Promise<TPTUserInfo> {
  const [res]: any = await pool.query(`
  SELECT
    *
  FROM
    users
  WHERE
    uid = ? AND
    site = ?;
  `, [uid, site]);
  if (0 === res.length) {
    return null;
  }
  const { cookie, vip, uploadCount, nickname, paid, bind_server, cycle_time, rss_passkey, user_data_dir, site_data_only, vip_normal_item_count, proxy, proxy_addr } = res[0];
  const servers: string[] = bind_server.split(',');
  const numServers: number[] = [];
  for (let i = 0; i < servers.length; i++) {
    const server: string = servers[i];
    numServers.push(Number(server));
  }
  const userInfo: TPTUserInfo = { 
    cookie, site, uid, uploadCount, paid, nickname,
    cycleTime: cycle_time,
    vip: Boolean(vip),
    serverIds: numServers,
    passkey: rss_passkey,
    userDataDir: user_data_dir,
    siteDataOnly: Boolean(site_data_only),
    vipNormalItemCount: vip_normal_item_count,
    proxy: Boolean(proxy),
    proxyAddr: proxy_addr
  };
  return userInfo;
}

export async function getUserInfoByQuery(query: any): Promise<TPTUserInfo> {
  let sql = `
  SELECT 
    *
  FROM
    users
  WHERE
    1 = 1
  `;

  const where = [];
  for (const key in query) {
    sql += `AND ${key} = ?`;
    where.push(query[key]);
  }

  const [res]: any = await pool.query(sql, where);
  if (0 === res.length) {
    return null;
  }
  const { cookie, vip, site, uid, uploadCount, nickname, paid, bind_server, cycle_time, rss_passkey, user_data_dir, site_data_only, vip_normal_item_count, proxy, proxy_addr } = res[0];
  const servers: string[] = bind_server.split(',');
  const numServers: number[] = [];
  for (let i = 0; i < servers.length; i++) {
    const server: string = servers[i];
    numServers.push(Number(server));
  }
  const userInfo: TPTUserInfo = { 
    cookie, site, uid, uploadCount, paid, nickname,
    cycleTime: cycle_time,
    vip: Boolean(vip),
    serverIds: numServers,
    passkey: rss_passkey,
    userDataDir: user_data_dir,
    siteDataOnly: Boolean(site_data_only),
    vipNormalItemCount: vip_normal_item_count,
    proxy: Boolean(proxy),
    proxyAddr: proxy_addr
  };
  console.log(userInfo);
  return userInfo;
}

export async function getUserInfo1(nickname: string, site: string): Promise<TPTUserInfo> {
  const [res]: any = await pool.query(`
  SELECT 
    *
  FROM
    users
  WHERE
    nickname = ? AND
    site = ?;
  `, [nickname, site]);
  if (0 === res.length) {
    return null;
  }
  const { cookie, uid, vip, bind_server, uploadCount, paid, cycle_time, rss_passkey, user_data_dir, site_data_only, vip_normal_item_count, proxy, proxy_addr } = res[0];
  const servers: string[] = bind_server.split(',');
  const numServers: number[] = [];
  for (let i = 0; i < servers.length; i++) {
    const server: string = servers[i];
    numServers.push(Number(server));
  }
  const userInfo: TPTUserInfo = {
    cookie, site, uid, uploadCount, paid, nickname,
    cycleTime: cycle_time,
    vip: Boolean(vip),
    serverIds: numServers,
    passkey: rss_passkey,
    userDataDir: user_data_dir,
    siteDataOnly: Boolean(site_data_only),
    vipNormalItemCount: vip_normal_item_count,
    proxy: Boolean(proxy),
    proxyAddr: proxy_addr
  };
  return userInfo;
}

export async function getServers(uid: string, serverIds: number[]): Promise<TPTServer[]> {
  log.log(`[Mysql] getServers: [${uid}], userIds: [${serverIds}]`);
  const [res]: any = await pool.query(`
  SELECT
    *
  FROM
    servers
  WHERE
    id in (?);
  `, [serverIds]);
  const servers: TPTServer[] = [];
  for (const item of res) {
    const { id, ip, port, username, password, type, box, file_download_path, min_space_left, min_stay_file_size, proxy, mac_address, agent_port, node_addr, proj_addr } = item;
    servers.push({
      id, ip, port, username, password, type,
      box: Boolean(box),
      fileDownloadPath: file_download_path,
      minSpaceLeft: min_space_left,
      minStayFileSize: min_stay_file_size,
      oriFileDownloadPath: file_download_path,
      macAddress: mac_address,
      proxy,
      agentPort: agent_port,
      nodeAddr: node_addr,
      projAddr: proj_addr
    });
  }
  return servers;
}

export async function getAllServers(): Promise<TPTServer[]> {
  log.log(`[Mysql] getAllServers`);
  const [res]: any = await pool.query(`
  SELECT
    *
  FROM
    servers
  `);
  const servers: TPTServer[] = [];
  for (const item of res) {
    const { id, ip, port, username, password, type, box, file_download_path, min_space_left, min_stay_file_size, proxy, mac_address, agent_port, node_addr, proj_addr } = item;
    servers.push({
      id, ip, port, username, password, type,
      box: Boolean(box),
      fileDownloadPath: file_download_path,
      minSpaceLeft: min_space_left,
      minStayFileSize: min_stay_file_size,
      oriFileDownloadPath: file_download_path,
      macAddress: mac_address,
      agentPort: agent_port,
      proxy,
      nodeAddr: node_addr,
      projAddr: proj_addr
    });
  }
  return servers;
}

export async function getUserActiveTransId(uid: string, site: string, serverId: number): Promise<number[]> {
  log.log(`[Mysql] getUserActiveTransId, uid: [${uid}] serverId: [${serverId}]`);
  const [res]: any = await pool.query(`
  SELECT
    *
  FROM
    downloader
  WHERE
    uid = ? AND
    server_id = ? AND
    deleted = 0 AND
    site = ?;
  `, [uid, serverId, site]);
  const activeIds: number[] = [];
  for (const item of res) {
    const { trans_id } = item;
    activeIds.push(trans_id);
  }
  return activeIds;
}

export async function deleteDownloaderItem(uid: string, site: string, serverId: number, transId: number): Promise<void> {
  log.log(`[Mysql] deleteDownloaderItem uid: [${uid}], site: [${site}] serverId: [${serverId}] transId: [${transId}]`);
  await pool.query(`
  UPDATE
    downloader
  SET
    deleted = 1
  WHERE
    uid = ? AND
    server_id = ? AND
    trans_id = ? AND
    site = ?;
  `, [uid, serverId, transId, site]);
}

export async function getLatestSiteData(uid: string, site: string): Promise<TSiteData> {
  log.log(`[Mysql] getLatestSiteData`);
  const [res]: any = await pool.query(`
  SELECT
    *
  FROM
    site_data
  WHERE
    uid = ? AND
    site = ?
  ORDER BY gmt_create DESC
  LIMIT 1;
  `, [uid, site]);
  const { share_ratio, upload_count, magic_point, download_count, upload_speed, download_speed } = res[0] || {};
  return {
    shareRatio: share_ratio,
    uploadCount: upload_count,
    downloadCount: download_count,
    magicPoint: magic_point,
    uploadSpeed: upload_speed,
    downloadSpeed: download_speed
  };
}

export async function getItemByTransIdAndServerId(transId: number, serverId: number, uid: string, site: string): Promise<TItem> {
  log.log(`[Mysql] getItemByTransIdAndServerId, transId: [${transId}], serverId: [${serverId}], site: [${site}], uid: [${uid}]`);
  const [res]: any = await pool.query(`
  SELECT
    torrents.uid as uid,
    torrents.site_id as id,
    torrents.is_free as is_free,
    torrents.size as size,
    torrents.free_until as free_until,
    torrents.publish_date as publish_date,
    torrents.title as title,
    downloader.server_id as server_id,
    downloader.torrent_hash as trans_hash
  FROM
    downloader
  LEFT JOIN
    torrents
  ON
    torrents.site = downloader.site AND
    torrents.site_id = downloader.site_id AND
    torrents.uid = downloader.uid
  WHERE
    downloader.server_id = ? AND
    downloader.trans_id = ? AND
    torrents.uid = ? AND
    torrents.site = ?;
  `, [serverId, transId, uid, site]);
  const { trans_hash, id, torrent_url, is_free, size, free_until, publish_date, title } = res[0];
  return {
    uid, id, title, size, site, serverId,
    free: Boolean(is_free),
    freeUntil: new Date(free_until),
    publishDate: new Date(publish_date),
    torrentUrl: torrent_url,
    transHash: trans_hash
  }
}

export async function getItemBySiteIds(uid: string, site: string, siteIds: string[]): Promise<TItem[]> {
  if (false === _.isArray(siteIds) || 0 === siteIds.length) {
    return [];
  }
  log.log(`[Mysql] getItemBySiteIds, uid: [${uid}], site: [${site}], siteIds: [${siteIds}]`);
  const [res]: any = await pool.query(`
  SELECT
    torrents.uid as uid,
    torrents.site_id as id,
    torrents.is_free as is_free,
    torrents.size as size,
    torrents.free_until as free_until,
    torrents.publish_date as publish_date,
    torrents.title as title,
    downloader.server_id as server_id,
    downloader.torrent_hash as trans_hash,
    downloader.trans_id as trans_id
  FROM
    torrents
  LEFT JOIN
    downloader
  ON
    torrents.site = downloader.site AND
    torrents.site_id = downloader.site_id AND
    torrents.uid = downloader.uid
  WHERE
    torrents.uid = ? AND
    torrents.site = ? AND
    torrents.site_id IN (?);
  `, [uid, site, siteIds]);
  const items: TItem[] = [];
  for (const item of res) {
    const { trans_hash, id, server_id, trans_id, torrent_url, is_free, size, free_until, publish_date, title } = item;
    items.push({
      uid, id, title, size, site, 
      serverId: server_id,
      free: Boolean(is_free),
      freeUntil: new Date(free_until),
      publishDate: new Date(publish_date),
      torrentUrl: torrent_url,
      transHash: trans_hash,
      transId: trans_id
    });
  }
  return items;
}


