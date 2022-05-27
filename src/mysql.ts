
import * as mysql from 'mysql2/promise';
import { TItem } from './types';
import * as config from './config';
import * as _ from 'lodash';
import * as log from './log';

import { TPTUserInfo, TPTServer } from './types';

export let pool: mysql.Pool = null;

export async function init(): Promise<void> {
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

export async function storeItem(items: TItem[]): Promise<void> {
  log.log(`[MYSQL] store items: [${JSON.stringify(items)}]`);
  for (const item of items) {
    const { id, freeUntil, size, title, torrentUrl, free, transHash } = item;
    await pool.query(`
    INSERT INTO
      torrents(gmt_create, gmt_modify, uid, site, site_id, size, torrent_url, is_free, free_until, title)
    VALUES(NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      size = VALUES(size),
      torrent_url = VALUES(torrent_url),
      free_until = VALUES(free_until),
      is_free = VALUES(is_free);
    `, [config.uid, config.site, id, size, torrentUrl, Number(free), freeUntil, title]);
  }
};

export async function getFreeItems(): Promise<TItem[]> {
  log.log(`[MYSQL] get free item`);
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
        torrents.free_until > NOW() AND
        torrents.uid = ? AND
        torrents.site = ?
    ) AS temp
    WHERE
      downloader_id IS NULL;
    `, [config.uid, config.site]);
  log.log(`[MYSQL] get free item: [${JSON.stringify(data)}]`);
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
      publishDate: publish_date
    });
  }
  return freeItems;
}

export async function storeDownloadAction(site: string, siteId: string, uid: string, transId: string, torrentHash: string, serverId: number): Promise<void> {
  log.log(`[MYSQL] storeDownloadAction site: [${site}], site id: [${siteId}], uid: [${uid}], trans id: [${transId}], torrent hash: [${torrentHash}] server id: [${serverId}]`);
  await pool.query(`
  INSERT INTO downloader(gmt_create, gmt_modify, uid, trans_id, torrent_hash, site, site_id, server_id)
  VALUES (NOW(), NOW(), ?, ?, ?, ?, ?, ?)
  `, [uid, transId, torrentHash, site, siteId, serverId]);
}

export async function updateTorrentHashBySiteAndId(site: string ,siteId: string, torrentHash: string): Promise<void> {
  log.log(`[MYSQL] updateTorrentHashBySiteAndId, site: [${site}], site id: [${siteId}], torrent hash: [${torrentHash}]`);
  await pool.query(`
  UPDATE
    torrents
  SET
    torrent_hash = ?
  WHERE
    site = ? AND site_id = ?;
  `, [torrentHash, site, siteId]);
}

export async function getTransIdByItem(items: TItem[]): Promise<string[]> {
  log.log(`[MYSQL] getTransIdByItem: [${JSON.stringify(items)}]`);
  if (0 === items.length) {
    return [];
  }
  const itemIds: string[] = [];
  const transIds: string[] = [];
  for (const item of items) {
    const { id } = item;
    itemIds.push(id);
    try {
      const [res] = await pool.query(`
      SELECT *
      FROM downloader
      WHERE
        site = ? AND site_id = ?;
      `,[item.site, item.id]);
      transIds.push(res[0].trans_id);
    } catch (e) {
      log.log(e.message);
      log.log(e.stack);
    }
  }
  return transIds;
}

export async function getItemByHash(hash: string[]): Promise<TItem[]> {
  log.log(`[MYSQL] get item by hash: [${JSON.stringify(hash)}]`);
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
    torrents.torrent_hash IN (?);
  `, [config.uid, hash]);
  const items: TItem[] = [];
  for (const item of res) {
    const { site_id, uid, site, title, size, torrent_url, torrent_hash, free_until, server_id, publish_date } = item;
    items.push({
      size, title,
      id: site_id,
      site: site,
      uid,
      torrentUrl: torrent_url,
      transHash: torrent_hash,
      freeUntil: free_until,
      serverId: server_id,
      publishDate: publish_date
    });
  }
  return items;
}

export async function storeSiteInfo(
  shareRatio: number, 
  downloadCount: number,
  uploadCount: number,
  magicPoint: number,
  uploadSpeed: number,
  downloadSpeed: number
): Promise<void> {
  log.log(`[MYSQL] store site info, share ratio: [${shareRatio}], download count: [${downloadCount}], upload count: [${uploadCount}], magic point: [${magicPoint}], upload speed: [${uploadSpeed}], download speed: [${downloadSpeed}]`);
  await pool.query(`
  INSERT INTO 
    site_data(gmt_create, gmt_modify, site, uid, share_ratio, download_count, upload_count, magic_point, upload_speed, download_speed)
  VALUE(NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
  `, [config.site, config.uid, shareRatio || 0, downloadCount || 0, uploadCount || 0, magicPoint || 0, uploadSpeed || 0, downloadSpeed]);
}

export async function getUserInfoByUid(uid: string): Promise<TPTUserInfo> {
  const [res]: any = await pool.query(`
  SELECT 
    *
  FROM
    users
  WHERE
    uid = ?;
  `, [uid]);
  if (0 === res.length) {
    return null;
  }
  const { cookie, vip, uploadCount, site, nickname, paid, bind_server, cycle_time, rss_passkey, user_data_dir, site_data_only } = res[0];
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
    siteDataOnly: Boolean(site_data_only)
  };
  return userInfo;
}

export async function getUserInfo(nickname: string, site: string): Promise<TPTUserInfo> {
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
  const { cookie, uid, vip, bind_server, uploadCount, paid, cycle_time, rss_passkey, user_data_dir, site_data_only } = res[0];
  const userInfo: TPTUserInfo = {
    cookie, site, uid, uploadCount, paid, nickname,
    cycleTime: cycle_time,
    vip: Boolean(vip),
    serverIds: bind_server,
    passkey: rss_passkey,
    userDataDir: user_data_dir,
    siteDataOnly: Boolean(site_data_only)
  };
  return userInfo;
}

export async function getServers(uid: string): Promise<TPTServer[]> {
  const userInfo: TPTUserInfo = await getUserInfoByUid(uid);
  const [res]: any = await pool.query(`
  SELECT
    *
  FROM
    servers
  WHERE
    id in (?);
  `, [userInfo.serverIds]);
  const servers: TPTServer[] = [];
  for (const item of res) {
    const { id, ip, port, username, password, type, box, file_download_path, min_space_left, min_stay_file_size } = item;
    servers.push({
      id, ip, port, username, password, type,
      box: Boolean(box),
      fileDownloadPath: file_download_path,
      minSpaceLeft: min_space_left,
      minStayFileSize: min_stay_file_size,
      oriFileDownloadPath: file_download_path
    });
  }
  return servers;
}
