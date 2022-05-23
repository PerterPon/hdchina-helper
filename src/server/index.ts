
import * as http from 'http';

import * as log from '../log';
import * as config from '../config';

config.init();
const configInfo = config.getConfig();
const { port } = configInfo.server;

const app = http.createServer(reqHandler);
app.listen(port, () => {
  console.log(`pt server listening: [${port}]!`);
});

async function reqHandler(req: http.IncomingMessage, res: http.OutgoingMessage): Promise<void> {
  
}
