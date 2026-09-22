import { context } from 'esbuild';
import { addDeepDigIcon } from './deep-dig-icon.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './dev-game.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function buildDeepDig({watch=false}={}) {
 const outdir=resolve(root,'games/deep-dig/.local');await mkdir(outdir,{recursive:true});
 const build=await context({absWorkingDir:root,entryPoints:['games/deep-dig/local.tsx'],outfile:resolve(outdir,'runtime.js'),bundle:true,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},minify:true,logLevel:'warning'});
 await build.rebuild();if(watch)await build.watch();else await build.dispose();
 const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 await writeFile(resolve(outdir,'index.html'),`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="theme-color" content="#101b22"><title>Deep Dig · simulated RF only</title><link rel="stylesheet" href="/runtime.css"></head><body><main id="root"></main><script src="/runtime.js"></script></body></html>`);
 await addDeepDigIcon(outdir);
 await writeFile(resolve(outdir,'.friendsdk-output.json'),JSON.stringify({version:1,files:['index.html','runtime.js','runtime.css']}));
 return {outdir,close:()=>build.dispose()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);let host='127.0.0.1',port=4173,buildOnly=false;
 while(args.length){const key=args.shift();if(key==='--build')buildOnly=true;else if(key==='--host')host=args.shift();else if(key==='--port')port=Number(args.shift());else throw Error(`Unsupported option ${key}. Deep Dig has no live or deployment mode.`);}
 if(!['127.0.0.1','0.0.0.0','localhost'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local host or port.');
 const built=await buildDeepDig({watch:!buildOnly});
 if(buildOnly)console.log('Built Deep Dig locally. No network calls or deployment.');
 else{const server=createGameServer(built.outdir);server.on('error',e=>{console.error(e.message);process.exit(1);});server.listen(port,host,()=>console.log(`Deep Dig · simulated RF only\nComputer: http://localhost:${port}\n${host==='0.0.0.0'?`Phone: http://YOUR_COMPUTER_LAN_IP:${port} (same Wi-Fi)\n`:''}Source edits rebuild automatically. Refresh to load them. Ctrl+C to stop.`));const close=async()=>{server.closeAllConnections();server.close();await built.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);}
}
