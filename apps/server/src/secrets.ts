import { createCipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Config } from './config.js';
export async function masterKey(config:Config) {
  if(config.masterKey) { const key=Buffer.from(config.masterKey,'base64');if(key.length!==32)throw new Error('COSHIP_MASTER_KEY must contain 32 base64-encoded bytes');return key; }
  if(config.mode==='enterprise')throw new Error('Master key required');
  if(config.dataDir===':memory:')return randomBytes(32);
  await mkdir(config.dataDir,{recursive:true});const file=`${config.dataDir}/master.key`;
  try{return await readFile(file)}catch(error:any){if(error.code!=='ENOENT')throw error;const key=randomBytes(32);await writeFile(file,key,{mode:0o600,flag:'wx'});return key;}
}
export function encryptSecret(value:string,key:Buffer) { const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}); }
