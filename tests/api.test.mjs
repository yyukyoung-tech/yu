import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {fileURLToPath} from 'node:url';
import request from 'supertest';
import yauzl from 'yauzl';
import { createApp } from '../server/app.mjs';
import { provisionAdmin } from '../server/auth.mjs';
import { digest } from '../server/auth.mjs';
import { validateFile } from '../server/files.mjs';
import { restoreBackup } from '../server/backup.mjs';
import { openDb } from '../server/db.mjs';

const origin='http://127.0.0.1:4310';
let ctx,dir,agent,csrf,assignment,receipt;
const student={grade:1,classNo:1,number:1,name:'가상학생01'};
const spec={title:'파이썬 조건문 실습',description:'가상 자료만 사용',grade:1,classes:[1,2],startsAt:'2020-01-01T00:00:00.000Z',dueAt:'2099-01-01T00:00:00.000Z',extensions:['.py','.txt','.png','.zip','.docx'],maxMB:1,allowResubmit:true,allowLate:false,code:'classroom-123'};
before(async()=>{dir=mkdtempSync(join(tmpdir(),'과제 수합 한글 경로 '));ctx=createApp({dataDir:dir,origin,secureCookies:false,rateLimits:false});await provisionAdmin(ctx.db,'teacher','test-password-123!');agent=request.agent(ctx.app);const login=await agent.post('/api/login').set('Origin',origin).send({username:'teacher',password:'test-password-123!'});assert.equal(login.status,200);csrf=login.body.csrf;});
after(()=>{ctx?.close();rmSync(dir,{recursive:true,force:true});});
const post=(url,data)=>agent.post(url).set('Origin',origin).set('X-CSRF-Token',csrf).send(data);
const upload=(data={},body=Buffer.from('print("가상 과제")'),filename='실습.py')=>request(ctx.app).post('/api/submissions').set('Origin',origin).field('metadata',JSON.stringify({...student,assignmentId:assignment,code:spec.code,...data})).attach('file',body,filename);

test('관리자 인증 실패와 CSRF 거부; 공개 API에 개인정보 없음',async()=>{
 assert.equal((await request(ctx.app).post('/api/login').set('Origin',origin).send({username:'teacher',password:'wrong'})).status,401);
 assert.equal((await request(ctx.app).get('/api/admin/students')).status,401);
 assert.equal((await agent.post('/api/admin/assignments').send(spec)).status,403);
 assert.equal((await request(ctx.app).get('/api/public')).status,200);
});
test('과제 생성 → 저장 성공 → 확인번호 → 관리자 원본 다운로드',async()=>{
 const r=await post('/api/admin/assignments',spec);assert.equal(r.status,201,JSON.stringify(r.body));assignment=r.body.id;
 const pub=(await request(ctx.app).get('/api/public')).body;assert.equal(pub.assignments[0].title,spec.title);assert.equal(pub.assignments[0].code,undefined);assert.equal(pub.assignments[0].codeHash,undefined);
 const s=await upload();assert.equal(s.status,201,JSON.stringify(s.body));receipt=s.body.receipt;assert.ok(receipt.length>=24);assert.equal(s.body.version,1);assert.ok(s.body.submittedAt);
 const reports=await agent.get(`/api/admin/report?assignmentId=${assignment}`);assert.equal(reports.body.rosterKnown,false);assert.equal(reports.body.missing,null);
 const versions=await agent.get(`/api/admin/history/${s.body.id}`);assert.equal(versions.body.length,1);
 const file=await agent.get(`/api/admin/files/${versions.body[0].id}`);assert.equal(file.status,200);assert.equal(file.body.toString(), 'print("가상 과제")');
 assert.equal((await request(ctx.app).get(`/api/admin/files/${versions.body[0].id}`)).status,401);
 assert.equal((await request(ctx.app).get(`/uploads/${versions.body[0].storageName}`)).status,404);
});
test('누락·위장 확장자·용량 초과·위험 ZIP·제출 코드 오류 거부',async()=>{
 const nofile=await request(ctx.app).post('/api/submissions').set('Origin',origin).field('metadata',JSON.stringify({...student,assignmentId:assignment,code:spec.code}));assert.equal(nofile.status,400);
 assert.equal((await upload({number:2},Buffer.from('MZfake'), '파일.py')).status,400);
 assert.equal((await upload({number:2},Buffer.from('not an image'), '파일.png')).status,400);
 assert.equal((await upload({number:2},Buffer.from('print(1)'), '파일.exe')).status,400);
 assert.equal((await upload({number:2},Buffer.alloc(1024*1024+1,65),'큰파일.txt')).status,413);
 assert.equal((await upload({number:2,code:'wrong'})).status,403);
 assert.equal((await upload({number:2,name:'<script>alert(1)</script>'})).status,400);
 assert.equal(readdirSync(join(dir,'tmp')).length,0);
});
test('다른 학생의 재제출 차단 및 확인번호로 이력 보존',async()=>{
 assert.equal((await upload()).status,409);
 assert.equal((await upload({receipt:'wrong'})).status,403);
 const r=await upload({receipt},Buffer.from('print(2)'));assert.equal(r.status,201);assert.equal(r.body.version,2);assert.equal(r.body.receipt,receipt);
 const h=await agent.get(`/api/admin/history/${r.body.id}`);assert.equal(h.body.length,2);
});
test('CSV 명단 일괄 검증, 현황 계산, 검색·정렬·학생 수정',async()=>{
 const csv='학년,반,번호,이름\n1,1,1,가상학생01\n1,1,2,가상학생02\n1,2,1,가상학생03';
 const r=await post('/api/admin/students/import',{csv});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.imported,3);
 const bad=await post('/api/admin/students/import',{csv:'학년,반,번호,이름\n1,1,3,정상\n1,1,4,중복\n1,1,4,중복2'});assert.equal(bad.status,400);
 const report=(await agent.get(`/api/admin/report?assignmentId=${assignment}`)).body;assert.equal(report.total,3);assert.equal(report.submitted,1);assert.equal(report.missing,2);assert.equal(report.rows[0].status,'재제출');
 const found=(await agent.get(`/api/admin/report?assignmentId=${assignment}&q=가상학생02&status=missing`)).body;assert.equal(found.rows.length,1);
 const id=(await agent.get('/api/admin/students')).body[2].id;
 assert.equal((await post('/api/admin/students',{id,grade:1,classNo:2,number:1,name:'가상수정'})).status,200);
});
test('32개 동시 제출, 중복 경쟁 제출 및 서버 재시작 후 지속',async()=>{
 const all=await Promise.all(Array.from({length:32},(_,i)=>upload({classNo:2,number:(i%30)+1,name:`가상${i}`, ...(i>=30?{classNo:1,number:i-27}:{})})));assert.ok(all.every(r=>r.status===201),JSON.stringify(all.map(r=>[r.status,r.body])));
 const race=await Promise.all([upload({number:29,name:'경쟁'}),upload({number:29,name:'경쟁'})]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
 ctx.close();ctx=createApp({dataDir:dir,origin,secureCookies:false,rateLimits:false});agent=request.agent(ctx.app);const l=await agent.post('/api/login').set('Origin',origin).send({username:'teacher',password:'test-password-123!'});csrf=l.body.csrf;assert.equal(l.status,200);assert.ok((await agent.get(`/api/admin/report?assignmentId=${assignment}`)).body.submitted>=1);
});
test('마감/재제출 설정·학급 범위·지각 상태',async()=>{
 const r=await post('/api/admin/assignments',{...spec,title:'마감 과제',dueAt:'2021-01-01T00:00:00.000Z'});const closed=r.body.id;
 assert.equal((await upload({assignmentId:closed})).status,400);
 assert.equal((await post('/api/admin/assignments',{...spec,id:closed,title:'마감 과제',dueAt:'2021-01-01T00:00:00.000Z',allowLate:true,allowResubmit:false})).status,200);
 const late=await upload({assignmentId:closed});assert.equal(late.status,201);assert.equal(late.body.late,true);
 assert.equal((await upload({assignmentId:closed,receipt:late.body.receipt})).status,400);
 assert.equal((await upload({classNo:10})).status,400);
});
test('ZIP 최신본과 UTF-8 현황 CSV, 전체/반별 다운로드',async()=>{
 const r=await agent.get(`/api/admin/export.zip?assignmentId=${assignment}&classNo=1`).buffer(true).parse((res,cb)=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks)));});assert.equal(r.status,200);
 const entries=await new Promise((resolve,reject)=>yauzl.fromBuffer(r.body,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const list=[];z.readEntry();z.on('entry',x=>{list.push(x.fileName);z.readEntry();});z.on('end',()=>resolve(list));z.on('error',reject);}));assert.ok(entries.some(x=>x.endsWith('제출현황.csv')));assert.equal(entries.filter(x=>x.includes('01_가상학생01')).length,1);assert.ok(!entries.some(x=>x.includes('..')));
 const csv=await agent.get(`/api/admin/report.csv?assignmentId=${assignment}`);assert.equal(csv.status,200);assert.match(csv.text,/가상학생01/);
 const extracted=await new Promise((resolve,reject)=>yauzl.fromBuffer(r.body,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const data=new Map();z.on('error',reject);z.on('end',()=>resolve(data));z.on('entry',x=>{z.openReadStream(x,(e,s)=>{if(e)return reject(e);const chunks=[];s.on('error',reject);s.on('data',c=>chunks.push(c));s.on('end',()=>{data.set(x.fileName,Buffer.concat(chunks).toString('utf8'));z.readEntry();});});});z.readEntry();}));assert.equal([...extracted].find(([name])=>name.includes('01_가상학생01'))[1],'print(2)');
});
test('설정 저장·학급 추가 및 보유기간 삭제 확인 절차',async()=>{
 assert.equal((await post('/api/admin/classes',{grade:2,classNo:1,maxNumber:35})).status,200);
 assert.equal((await post('/api/admin/settings',{maxMB:50,retentionDays:365})).status,200);
 assert.equal((await post('/api/admin/purge',{confirm:'no'})).status,400);
 const p=await post('/api/admin/purge',{confirm:'보유기간 지난 자료 삭제'});assert.equal(p.status,200);assert.equal(p.body.deleted,0);
});
test('검증 도중 바뀐 제출 정책은 저장 직전에 다시 확인',async()=>{
 const d=mkdtempSync(join(tmpdir(),'정책 경쟁 '));let race;
 try{race=createApp({dataDir:d,origin,secureCookies:false,rateLimits:false,validateUpload:async(f,a)=>{const hash=await validateFile(f,a);race.db.prepare('UPDATE assignments SET codeHash=? WHERE id=?').run(digest('rotated-code'),a.id);return hash;}});
 race.db.prepare('INSERT INTO assignments(title,description,grade,classes,startsAt,dueAt,extensions,maxMB,allowResubmit,allowLate,codeHash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('경쟁 테스트','',1,'[1]',spec.startsAt,spec.dueAt,'[".txt"]',1,1,0,digest(spec.code));
 const r=await request(race.app).post('/api/submissions').set('Origin',origin).field('metadata',JSON.stringify({...student,assignmentId:1,code:spec.code})).attach('file',Buffer.from('fake'),'fake.txt');assert.equal(r.status,409);assert.equal(race.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,0);
 }finally{race?.close();rmSync(d,{recursive:true,force:true});}
});
test('서버 저장 실패 시 성공 표시·DB 잔여 기록 없음',async()=>{
 const files=join(dir,'files');renameSync(files,files+'-saved');writeFileSync(files,'simulate unavailable storage');
 try{const r=await upload({number:28,name:'저장실패'});assert.equal(r.status,500);assert.equal(r.body.receipt,undefined);assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE assignmentId=? AND classNo=1 AND number=28').get(assignment).n,0);assert.equal(readdirSync(join(dir,'tmp')).length,0);}finally{rmSync(files);renameSync(files+'-saved',files);}
});
test('관리자 백업 API의 실제 제출 파일과 이전 이력 복원',async()=>{
 const r=await post('/api/admin/backup',{});assert.equal(r.status,200,JSON.stringify(r.body));const download=await agent.get('/api/admin/backup/'+r.body.name);assert.equal(download.status,200);assert.equal((await request(ctx.app).get('/api/admin/backup/'+r.body.name)).status,401);
 const target=join(dir,'restore-verification');await restoreBackup(join(dir,'backups',r.body.name),target);const db=openDb(target);try{const v=db.prepare('SELECT * FROM versions ORDER BY id LIMIT 1').get();assert.equal(readFileSync(join(target,'files',v.storageName),'utf8'),'print("가상 과제")');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.ok(db.prepare('SELECT COUNT(*) AS n FROM versions').get().n>32);}finally{db.close();}
});
test('공개/소스 폴더 안의 데이터 저장은 시작 단계에서 차단',()=>{const unsafe=fileURLToPath(new URL('../dist/security-regression-private',import.meta.url));let accidental;try{assert.throws(()=>{accidental=createApp({dataDir:unsafe,origin});},/데이터 저장/);}finally{accidental?.close();rmSync(unsafe,{recursive:true,force:true});}});
