
import * as mysql from 'mysql2/promise';
import { TItem } from './types';
import * as config from './config';
import * as _ from 'lodash';
import * as log from './log';

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
    const { id, freeUntil, size, title, torrentUrl, transHash } = item;
    await pool.query(`
    INSERT INTO
      torrents(gmt_create, gmt_modify, uid, site, site_id, size, torrent_url, is_free, free_until, title)
    VALUES(NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      size = VALUES(size),
      torrent_url = VALUES(torrent_url),
      free_until = VALUES(free_until);
    `, [config.uid, config.site, id, size, torrentUrl, 1, freeUntil, title]);
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
        downloader.id AS downloader_id
      FROM
        torrents
      LEFT JOIN
        downloader
      ON
        torrents.site = downloader.site AND
        torrents.site_id = downloader.site_id
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
    const { site_id, uid, site, size, title, is_free, free_until, torrent_url } = item;
    freeItems.push({
      id: site_id,
      site,
      uid,
      freeUntil: free_until,
      size, title,
      torrentUrl: torrent_url
    });
  }
  return freeItems;
}

export async function storeDownloadAction(site: string, siteId: string, uid: string, transId: string, torrentHash: string): Promise<void> {
  log.log(`[MYSQL] storeDownloadAction site: [${site}], site id: [${siteId}], uid: [${uid}], trans id: [${transId}], torrent hash: [${torrentHash}]`);
  await pool.query(`
  INSERT INTO downloader(gmt_create, gmt_modify, uid, trans_id, torrent_hash, site, site_id)
  VALUES (NOW(), NOW(), ?, ?, ?, ?, ?)
  `, [uid, transId, torrentHash, site, siteId]);
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
    *
  FROM
    torrents
  WHERE
    torrent_hash IN (?)
  `, [hash]);
  const items: TItem[] = [];
  for (const item of res) {
    const { site_id, uid, site, title, size, torrent_url, torrent_hash, free_until } = item;
    items.push({
      size, title,
      id: site_id,
      site: site,
      uid,
      torrentUrl: torrent_url,
      transHash: torrent_hash,
      freeUntil: free_until
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
