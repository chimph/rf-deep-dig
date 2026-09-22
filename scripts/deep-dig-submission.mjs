import { buildGame, createGameServer } from '@rarefriends/friendsdk/build';
import { addDeepDigIcon } from './deep-dig-icon.mjs';

// This entry point intentionally accepts no deployment configuration.
const args = process.argv.slice(2);
let buildOnly = false, port = 4175, host = '127.0.0.1';
while (args.length) {
  const key = args.shift();
  if (key === '--build') buildOnly = true;
  else if (key === '--port') port = Number(args.shift());
  else if (key === '--host') host = args.shift();
  else throw Error(`Unsupported option ${key}. Deep Dig submission is simulation only.`);
}
if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid local host or port.');
if (!buildOnly && [4173, 4174].includes(port)) throw Error('Ports 4173/4174 are reserved for the existing offline saves. Use 4175 or another port.');
const built = await buildGame('games/deep-dig', { watch: !buildOnly });
await addDeepDigIcon(built.outdir);
if (buildOnly) console.log(`Built wallet-gated, simulated Deep Dig: ${built.outdir}`);
else {
  const server = createGameServer(built.outdir);
  server.on('error', error => { console.error(error.message); process.exit(1); });
  server.listen(port, host, () => console.log(`Deep Dig submission preview: http://localhost:${port}\nOfficial wallet + ownership reads. All RF simulated. Offline saves remain at localhost:4173.`));
  const close = async () => { server.closeAllConnections(); server.close(); await built.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
