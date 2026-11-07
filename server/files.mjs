import { createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import yauzl from 'yauzl';
import { fail } from './validation.mjs';

const dangerous=/\.(exe|dll|com|scr|msi|bat|cmd|ps1|vbs|js|jse|hta|lnk|url|reg|jar|vbe|wsf)$/i;
export function unsafeArchivePath(name){return name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.'||p.includes(':'))||/[\x00-\x1f]/.test(name);}
export function zipEntries(path){return new Promise((resolve,reject)=>yauzl.open(path,{lazyEntries:true,autoClose:true},(err,zip)=>{if(err)return reject(err);const list=[];let total=0;zip.on('error',reject);zip.on('entry',entry=>{total+=entry.uncompressedSize;const mode=(entry.externalFileAttributes>>>16)&0xf000;if(list.length>=5000||total>512*1024*1024||unsafeArchivePath(entry.fileName)||mode===0xa000||(entry.generalPurposeBitFlag&1)||dangerous.test(entry.fileName)||/vbaProject\.bin$/i.test(entry.fileName)){zip.close();return reject(new Error('위험하거나 너무 큰 압축 항목'));}list.push(entry);zip.readEntry();});zip.on('end',()=>resolve(list));zip.readEntry();}));}
async function validateEnt(path,gzip){
 const input=createReadStream(path);const stream=gzip?input.pipe(createGunzip()):input;
 let pending=Buffer.alloc(0),skip=0,total=0,found=false,count=0;
 try{for await(const chunk of stream){total+=chunk.length;if(total>512*1024*1024)throw new Error('too large');pending=Buffer.concat([pending,chunk]);while(pending.length){if(skip){const take=Math.min(skip,pending.length);skip-=take;pending=pending.subarray(take);continue;}if(pending.length<512)break;const h=pending.subarray(0,512);pending=pending.subarray(512);if(h.every(x=>x===0))continue;const str=(a,b)=>h.subarray(a,b).toString('utf8').replace(/\0.*$/s,'');const name=[str(345,500),str(0,100)].filter(Boolean).join('/');const size=parseInt(str(124,136).trim(),8);const type=String.fromCharCode(h[156]);if(!Number.isSafeInteger(size)||size<0||unsafeArchivePath(name)||!['0','\0','5','x','g'].includes(type)||dangerous.test(name)||++count>5000)throw new Error('invalid tar');const checksum=parseInt(str(148,156).trim(),8);let sum=0;for(let i=0;i<512;i++)sum+=(i>=148&&i<156)?32:h[i];if(sum!==checksum)throw new Error('invalid checksum');if(name==='temp/project.json'&&size>0)found=true;skip=Math.ceil(size/512)*512;}}if(!found||skip||pending.length)throw new Error('invalid project');}finally{stream.destroy();input.destroy();}
}
export async function validateFile(file,assignment){
 const ext=extname(file.originalname).toLowerCase();if(!assignment.extensions.includes(ext))fail(400,'허용하지 않는 파일 형식입니다. 과제의 허용 형식을 확인하세요.');
 if(file.size===0)fail(400,'빈 파일은 제출할 수 없습니다. 내용을 저장한 뒤 다시 선택하세요.');
 if(file.size>assignment.maxMB*1024*1024)fail(413,`파일은 ${assignment.maxMB}MB 이하여야 합니다.`);
 const fd=openSync(file.path,'r');const head=Buffer.alloc(Math.min(8192,file.size));try{readSync(fd,head,0,head.length,0);}finally{closeSync(fd);}
 if(head.subarray(0,2).toString()==='MZ'||head.subarray(0,4).equals(Buffer.from([0x7f,69,76,70])))fail(400,'실행 파일은 제출할 수 없습니다.');
 try{
 if(['.txt','.py'].includes(ext)){const decoder=new TextDecoder('utf-8',{fatal:true});for await(const chunk of createReadStream(file.path)){if(chunk.includes(0))throw new Error();decoder.decode(chunk,{stream:true});}decoder.decode();}
 else if(ext==='.pdf'){if(!head.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error();}
 else if(ext==='.png'){if(!head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error();}
 else if(['.jpg','.jpeg'].includes(ext)){if(head[0]!==255||head[1]!==216||head[2]!==255)throw new Error();}
 else if(ext==='.hwp'){if(!head.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw new Error();}
 else if(ext==='.ent'){await validateEnt(file.path,head[0]===31&&head[1]===139);}
 else{const list=await zipEntries(file.path);const names=list.map(e=>e.fileName);const expected={'.docx':'word/document.xml','.pptx':'ppt/presentation.xml','.xlsx':'xl/workbook.xml','.hwpx':'Contents/content.hpf'}[ext];if(!list.length||(expected&&!names.includes(expected)))throw new Error();}
 }catch{fail(400,'파일 내용이 확장자와 다르거나 안전 정책에 맞지 않습니다. 원래 프로그램에서 다시 저장하세요. 텍스트·파이썬은 UTF-8을 사용하세요.');}
 const hash=createHash('sha256');for await(const c of createReadStream(file.path))hash.update(c);return hash.digest('hex');
}
