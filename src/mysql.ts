
import * as mysql from 'mysql2/promise';
import { TItem } from 'src';
import * as config from './config';
import { displayTime } from './utils';
import * as _ from 'lodash';

export let pool: mysql.Pool = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { host, user, password, database, waitForConnections, connectionLimit, queueLimit } = configInfo.hdchina.mysql;
  pool = mysql.createPool({
    host, user, password, database, waitForConnections, connectionLimit, queueLimit
  });

}

export async function storeItem(items: TItem[]): Promise<void> {
  console.log(`[${displayTime()}] [MYSQL] store items: [${JSON.stringify(items)}]`);
  for (const item of items) {
    const { id, freeUntil, size, title, hash, torrentUrl, transHash } = item;
    await pool.query(`
    INSERT INTO
      torrent(gmt_create, gmt_modify, pt_id, free_until, size, hash, site, title, torrent_url, trans_hash)
    VALUES 
      (?, ?, ?, ?, ?, ?, "hdchina", ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      size = VALUES(size);
    `, [new Date(), new Date(), id, freeUntil, size, hash, title, torrentUrl, transHash]);
  }
};

export async function getFreeItems(): Promise<TItem[]> {
  console.log(`[${displayTime()}] [MYSQL] get free item`);
  const [data]: any = await pool.query(`
    SELECT 
      *
    FROM
      torrent
    WHERE
      free_until > NOW() AND status = 0;
    `);
  console.log(console.log(`[${displayTime()}] [MYSQL] get free item: [${JSON.stringify(data)}]`));
  const freeItems: TItem[] = [];
  for (const item of data) {
    const { pt_id, free_util, size, hash, title, torrent_url, trans_hash} = item;
    freeItems.push({
      id: pt_id,
      freeUntil: free_util,
      size, hash, title,
      torrentUrl: torrent_url,
      transHash: trans_hash
    });
  }
  return freeItems;
}

export async function updateItemByTransHash(transHash: string, updateContent: any): Promise<void> {
  console.log(`[${displayTime()}] [MYSQL] updateItemByTransHash transHash: [${transHash}], updateContent: [${JSON.stringify(updateContent)}]`);
  const updateKeys: string[] = [];
  const updateValues: any[] = [];
  let updateItemString: string = '';
  for (const key in updateContent) {
    updateKeys.push(key);
    updateValues.push(updateContent[key]);
    updateItemString += `${key}=?,`;
  }
  updateItemString += 'gmt_modify = NOW()'
  await pool.query(`
  UPDATE
    torrent
  SET
    ${updateItemString}
  WHERE
    trans_hash = ?;
  `, [...updateValues, transHash]);
}

export async function getTransIdByItem(items: TItem[]): Promise<string[]> {
  console.log(`[${displayTime()}] [MYSQL] getTransIdByItem: [${JSON.stringify(items)}]`);
  if (0 === items.length) {
    return [];
  }
  const itemIds: string[] = [];
  for (const item of items) {
    const { id } = item;
    itemIds.push(id);
  }
  const [res]: any = await pool.query(`
  SELECT 
    *
  FROM
    torrent
  WHERE
    pt_id IN (?) AND site = 'hdchina';
  `, [itemIds]);
  const transIds: string[] = [];
  for (const item of res) {
    transIds.push(item.trans_id);
  }
  return transIds;
}

export async function getItemByHash(hash: string[]): Promise<TItem[]> {
  console.log(`[${displayTime()}] [MYSQL] get item by hash: [${JSON.stringify(hash)}]`);
  if (0 === hash.length) {
    return [];
  }
  const [res]: any = await pool.query(`
  SELECT
    *
  FROM
    torrent
  WHERE
    trans_hash IN (?)
  `, [hash]);
  const items: TItem[] = [];
  for (const item of res) {
    const { pt_id, hash, title, size, torrent_url, trans_id, trans_hash } = item;
    items.push({
      size, title, hash,
      id: pt_id,
      torrentUrl: torrent_url,
      transHash: trans_hash
    });
  }
  return items;
}

export async function setItemDownloading(items: TItem[]): Promise<void> {
  console.log(`[${displayTime()}] [MYSQL] setItemDownloading: [${JSON.stringify(items)}]`);
  for (const item of items) {
    const { transHash } = item;
    await pool.query(`
    UPDATE
      torrent
    SET
      status = 1
    WHERE
      trans_hash = ?;
    `, [ transHash ]);
  }
}
