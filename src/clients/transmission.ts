
import { TPTServer, TTransmission } from "src/types";
import * as _ from 'lodash';
import { promisify } from 'util';

import { IClient } from './basic';

const Transmission = require('transmission');

export class TransmissionClient implements IClient {
  client: TTransmission = null;
  serverInfo: TPTServer;

  constructor(serverInfo: TPTServer) {
    this.serverInfo = serverInfo;
  }

  async init(): Promise<void> {
    const { ip, port, username, password } = this.serverInfo;
    const client = new Transmission({
      host: ip,
      ssl: false,
      port, username, password
    });
    Object.assign(status, client.status);
    for (const fnName in client) {
      const fn = client[fnName];
      if (true === _.isFunction(fn)) {
        client[fnName] = promisify(fn);
      }
    }
  }

  async addTorrent(content: Buffer, savePath: string, torrentHash: string): Promise<{ id: string }> {
    const base64Content = content.toString('base64');
    const res = await this.client.addBase64(base64Content, {
      'download-dir': savePath
    });
    return res;
  }

  async addTorrentUrl(url: string, savePath: string, torrentHash: string, tag: string, fileName: string): Promise<{ id: string; }> {
    const res = await this.client.addUrl(url, {
      'download-dir': savePath
    });
    return res;
  }

  async removeTorrent(id: string): Promise<void> {
    await this.client.remove(id, true);
  }

  async getTorrents(): Promise<any> {
    return [];
  }

  async addTags(torrentHash: string, tag: string): Promise<void> {
    return;
  }

}


