import { configFromEnv } from './config.js';
import { createApp } from './app.js';
const config=configFromEnv();
const {server}=await createApp(config);
await server.listen({host:config.host,port:config.port});
console.log(`CoShip API: http://${config.host}:${config.port} · ${config.mode}`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close().then(()=>process.exit(0)));
