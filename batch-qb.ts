
import { TPTServer } from './src/types';
import * as config from './src/config';
import * as mysql from './src/mysql';
import { createClientByServer, IClient } from './src/clients/basic';

async function start() {

  await config.init();
  await mysql.init();

  const servers: TPTServer[] = await mysql.getAllServers();

  for(const server of servers) {
    const client: IClient = await createClientByServer(server);
    const torrents = await client.getTorrents();
    for (const torrent of torrents) {
      const { save_path, hash } = torrent;
      const items = save_path.split('\/');
      items.pop();
      const siteId = items.pop();
      const uid = items.pop();
      const site = items.pop();
      await client.addTags(hash, `${site}/${uid}`);
    }
  }

}

start();
