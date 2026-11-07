import { DatabaseSync, backup } from 'node:sqlite';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import archiver from './archive.mjs';
import yauzl from 'yauzl';
const hash=async(path)=>{const h=createHash('sha256');for await(const c of createReadStream(path))h.update(c);return h.digest('hex');};
export async function writeArchive(destination,files,manifest={}){const zip=archiver('zip',{zlib:{level:3}});const output=createWriteStream(destination,{flags:'wx'});zip.on('warning',err=>zip.destroy(err));const done=pipeline(zip,output);for(const f of files)zip.file(f.path,{name:f.name});zip.append(JSON.stringify(manifest),{name:'manifest.json'});await Promise.all([done,zip.finalize()]);}
export async function createBackup(dataDir,destination){
 if(existsSync(destination))throw new Error('기존 백업을 덮어쓸 수 없습니다. 새 파일명을 사용하세요.');mkdirSync(dirname(destination),{recursive:true});const scratch=mkdtempSync(join(tmpdir(),'assignment-backup-'));const partial=`${destination}.${randomUUID()}.partial`;
 try{const source=new DatabaseSync(join(dataDir,'data.sqlite'),{readOnly:true});try{await backup(source,join(scratch,'data.sqlite'));}finally{source.close();}const snapshot=new DatabaseSync(join(scratch,'data.sqlite'));snapshot.exec('DELETE FROM sessions; PRAGMA journal_mode=DELETE;');const files=snapshot.prepare('SELECT storageName,sha256 FROM versions').all();snapshot.close();const manifest={format:1,createdAt:new Date().toISOString(),files:[{name:'data.sqlite',sha256:await hash(join(scratch,'data.sqlite'))},...files.map(f=>({name:`files/${f.storageName}`,sha256:f.sha256}))]};
 const archiveFiles=[{path:join(scratch,'data.sqlite'),name:'data.sqlite'}];for(const f of files){const path=join(dataDir,'files',f.storageName);if(await hash(path)!==f.sha256)throw new Error('저장 파일 무결성 오류. 백업을 중단했습니다.');archiveFiles.push({path,name:`files/${f.storageName}`});}await writeArchive(partial,archiveFiles,manifest);renameSync(partial,destination);return destination;
 }finally{rmSync(scratch,{recursive:true,force:true});if(existsSync(partial))rmSync(partial);}
}
export async function restoreBackup(archive,target){
 if(existsSync(target))throw new Error('복원은 존재하지 않는 새 폴더에만 가능합니다. 원본은 보존됩니다.');mkdirSync(dirname(target),{recursive:true});const stage=mkdtempSync(join(dirname(target),'.restore-'));let zip;
 try{zip=await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true},(e,z)=>e?reject(e):resolve(z)));const seen=new Set();let total=0;await new Promise((resolve,reject)=>{zip.on('error',reject);zip.on('end',resolve);zip.on('entry',entry=>{(async()=>{const n=entry.fileName;total+=entry.uncompressedSize;if(!/^(data\.sqlite|manifest\.json|files\/[a-f0-9-]{36})$/.test(n)||seen.has(n)||(entry.generalPurposeBitFlag&1)||total>128*1024**3)throw new Error('올바른 백업 형식이 아닙니다.');seen.add(n);if(n==='manifest.json'&&entry.uncompressedSize>10*1024*1024)throw new Error('백업 목록이 너무 큽니다.');const dest=join(stage,n);mkdirSync(dirname(dest),{recursive:true});const input=await new Promise((r,j)=>zip.openReadStream(entry,(e,s)=>e?j(e):r(s)));await pipeline(input,createWriteStream(dest,{flags:'wx'}));zip.readEntry();})().catch(reject);});zip.readEntry();});
 const manifest=JSON.parse(readFileSync(join(stage,'manifest.json'),'utf8'));if(manifest.format!==1||!Array.isArray(manifest.files)||manifest.files.length!==seen.size-1)throw new Error('백업 목록이 올바르지 않습니다.');const declared=new Set();for(const f of manifest.files){if(typeof f.name!=='string'||!seen.has(f.name)||f.name==='manifest.json'||declared.has(f.name)||await hash(join(stage,f.name))!==f.sha256)throw new Error('백업 파일 무결성 검사 실패');declared.add(f.name);}
 const db=new DatabaseSync(join(stage,'data.sqlite'));try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA user_version').get().user_version!==1)throw new Error('데이터베이스 검증 실패');const rows=db.prepare('SELECT storageName,sha256 FROM versions').all();for(const f of rows)if(!manifest.files.some(x=>x.name===`files/${f.storageName}`&&x.sha256===f.sha256))throw new Error('제출 파일 목록 불일치');db.exec('DELETE FROM sessions;');}finally{db.close();}renameSync(stage,target);return target;
 }catch(e){zip?.close();throw e;}finally{if(existsSync(stage))rmSync(stage,{recursive:true,force:true});}
}
