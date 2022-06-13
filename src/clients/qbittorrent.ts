
const Qbittorrent = require('node-qbittorrent');

import { TPTServer, TQbitTorrent, TTransmission } from "src/types";
import * as _ from 'lodash';
import { promisify } from 'util';
import * as log from '../log';

import { IClient } from './basic';
import * as config from '../config';

export class QbittorrentClient implements IClient {
  client: TQbitTorrent = null;
  serverInfo: TPTServer;

  constructor(serverInfo: TPTServer) {
    this.serverInfo = serverInfo;
  }

  async init(): Promise<void> {
    const { ip, port, username, password } = this.serverInfo;
    const client = new Qbittorrent({
      host: ip,
      port,
      user: username,
      pass: password
    });
    client.login = promisify(client.login);
    client.addTorrentFileContent = promisify(client.addTorrentFileContent);
    client.deleteAndRemove = promisify(client.deleteAndRemove);
    client.addTorrentURL = promisify(client.addTorrentURL);
    client.addTags = promisify(client.addTags);
    await client.login();
    this.client = client;
  }

  async addTorrent(content: Buffer, savePath: string, torrentHash: string, retryTime: number = 0): Promise<{id: string}> {
    try {
      const res = await this.client.addTorrentFileContent(content, torrentHash, {
        savepath: savePath
      });
      return {
        id: torrentHash
      }
      return res;
    } catch(e) {
      const configInfo = config.getConfig();
      const { globalRetryTime } = configInfo;
      if (retryTime >= globalRetryTime) {
        log.log(`[Qbittorrent] add torrent error reached [${globalRetryTime}] times`);
        throw e;
      } else {
        return await this.addTorrent(content, savePath, torrentHash, ++retryTime);
      }
    }
  }

  async addTorrentUrl(url: string, savePath: string, torrentHash: string, tag: string, retryTime: number = 0): Promise<{ id: string; }> {
    try {
      const res = await this.client.addTorrentURL(url, {
        savepath: savePath
      });
      await this.addTags(torrentHash, tag);
      return {
        id: torrentHash
      }
    } catch(e) {
      const configInfo = config.getConfig();
      const { globalRetryTime } = configInfo;
      if (retryTime >= globalRetryTime) {
        log.log(`[Qbittorrent] add torrent error reached [${globalRetryTime}] times`);
        throw e;
      } else {
        return await this.addTorrentUrl(url, savePath, torrentHash, tag, ++retryTime);
      }
    }
  }

  async removeTorrent(id: string): Promise<void> {
    await this.client.deleteAndRemove(id);
  }

  async addTags(torrentHash: string, tag: string): Promise<void> {
    await this.client.addTags(torrentHash, tag);
  }
}
