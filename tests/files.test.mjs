import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,statSync,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import archiver from '../server/archive.mjs';
import {validateFile,unsafeArchivePath} from '../server/files.mjs';
const policy={extensions:['.ent','.zip','.docx'],maxMB:50};
async function zip(path,entries){const z=archiver('zip');const done=pipeline(z,createWriteStream(path));for(const [name,text] of entries)z.append(text,{name});await Promise.all([done,z.finalize()]);}
function file(path,name){return {path,originalname:name,size:statSync(path).size};}
test('ZIP/워드 내부 구조 및 위험 파일, 경로 조작 검사',async()=>{const dir=mkdtempSync(join(tmpdir(),'형식 가상 '));try{const p=join(dir,'sample');await zip(p,[['work.py','print(1)']]);assert.equal((await validateFile(file(p,'과제.zip'),policy)).length,64);await assert.rejects(()=>validateFile(file(p,'과제.docx'),policy));await zip(p,[['word/document.xml','<document/>']]);assert.equal((await validateFile(file(p,'과제.docx'),policy)).length,64);await zip(p,[['run.exe','MZfake']]);await assert.rejects(()=>validateFile(file(p,'과제.zip'),policy));for(const path of ['../a','a/../b','C:/a','/a','a\\b'])assert.equal(unsafeArchivePath(path),true);}finally{rmSync(dir,{recursive:true,force:true});}});
test('엔트리 gzip/TAR 프로젝트와 손상 헤더 거부',async()=>{const dir=mkdtempSync(join(tmpdir(),'엔트리 가상 '));try{const head=Buffer.alloc(512);head.write('temp/project.json');head.write('00000000002\0',124,'ascii');head.fill(32,148,156);head[156]=48;head.write('ustar\0',257,'ascii');let sum=0;for(const x of head)sum+=x;head.write(sum.toString(8).padStart(6,'0')+'\0 ',148,'ascii');const p=join(dir,'sample');writeFileSync(p,gzipSync(Buffer.concat([head,Buffer.from('{}'),Buffer.alloc(510),Buffer.alloc(1024)])));assert.equal((await validateFile(file(p,'가상.ent'),policy)).length,64);head[10]^=1;writeFileSync(p,gzipSync(Buffer.concat([head,Buffer.alloc(1536)])));await assert.rejects(()=>validateFile(file(p,'가상.ent'),policy));}finally{rmSync(dir,{recursive:true,force:true});}});

