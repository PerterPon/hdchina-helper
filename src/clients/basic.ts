
import { TPTServer } from "../types";

import { QbittorrentClient } from './qbittorrent';
import { TransmissionClient } from './transmission';

export interface IClient {

  init(): Promise<void>;

  addTorrent(content: Buffer, savePath: string, torrentHash: string): Promise<{id: string}>;

  addTorrentUrl(url: string, savePath: string, torrentHash: string, tag: string): Promise<{id: string}>;

  removeTorrent(id: string): Promise<void>;

}

export async function createClientByServer(serverInfo: TPTServer): Promise<IClient> {
  const { type } = serverInfo;
  let client: IClient = null;
  switch (type) {
    case 'transmission':
      client = new TransmissionClient(serverInfo);
      await client.init();
      break;
    case 'qbittorrent':
      client = new QbittorrentClient(serverInfo);
      await client.init();
      break;
    default:
      break;
  }
  return client;
}
