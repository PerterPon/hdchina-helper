
const Qbittorrent = require('@electorrent/node-qbittorrent');

import { TPTServer, TQbitTorrent, TTransmission } from "src/types";
import * as _ from 'lodash';
import { promisify } from 'util';

import { IClient } from './basic';

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
    await client.login();
    this.client = client;
  }

  async addTorrent(content: Buffer, savePath: string, torrentHash: string): Promise<{id: string}> {
    const res = await this.client.addTorrentFileContent(content, torrentHash, {
      savepath: savePath
    });
    return {
      id: torrentHash
    }
    return res;
  }

  async removeTorrent(id: string): Promise<void> {
    await this.client.deleteAndRemove(id);
  }
}
