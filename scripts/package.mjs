import {readdirSync,createWriteStream,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import archiver from '../server/archive.mjs';
if(!existsSync('dist/index.html'))throw new Error('먼저 pnpm build를 실행하세요.');mkdirSync('release',{recursive:true});const version=JSON.parse(readFileSync('package.json','utf8')).version;const path=resolve(`release/정보과제제출함-${version}-소스와빌드.zip`);const zip=archiver('zip',{zlib:{level:6}});const done=pipeline(zip,createWriteStream(path));zip.on('warning',e=>zip.destroy(e));
function walk(dir=''){for(const item of readdirSync(dir||'.',{withFileTypes:true})){if(['node_modules','release','.git','runtime','pages-dist','data','uploads','backups','tmp','files'].includes(item.name)||(item.name.startsWith('.env')&&item.name!=='.env.example')||/\.(?:log|db(?:-.*)?|sqlite.*|pem|key|p12|pfx)$/i.test(item.name)||/(?:service[-_]account|firebase-adminsdk).*\.json$/i.test(item.name))continue;const p=join(dir,item.name);if(item.isDirectory())walk(p);else if(item.isFile())zip.file(p,{name:'정보과제제출함/'+p.replaceAll('\\','/')});}}
walk();await Promise.all([done,zip.finalize()]);console.log(path);
