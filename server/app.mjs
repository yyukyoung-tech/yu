import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import archiver from './archive.mjs';
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseCsv } from 'csv-parse/sync';
import { openDb, audit, transaction } from './db.mjs';
import { token, digest, checkPassword, sessionGuard } from './auth.mjs';
import { parse, fail, AppError, classSchema, studentSchema, assignmentSchema, submissionSchema, settingsSchema, assignmentView, safePart } from './validation.mjs';
import { validateFile } from './files.mjs';
import { report, csvReport, getAssignment, exportName } from './reports.mjs';
import { createBackup } from './backup.mjs';

export function createApp({dataDir,origin='http://127.0.0.1:4310',secureCookies=true,rateLimits=true,trustProxy=false,validateUpload=validateFile}={}){
 const db=openDb(dataDir);let backingUp=false;const app=express();if(trustProxy)app.set('trust proxy',1);app.disable('x-powered-by');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:secureCookies?[]:null}},strictTransportSecurity:secureCookies?undefined:false}));
 app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('Origin')!==origin)return res.status(403).json({error:'허용된 사이트에서 다시 시도하세요. 관리자에게 접속 주소 설정을 확인해 달라고 요청하세요.'});next();});
 app.use(express.json({limit:'2mb'}));
 app.use('/api',(req,res,next)=>{if(backingUp&&!['GET','HEAD'].includes(req.method))return res.status(503).json({error:'백업 중입니다. 잠시 후 다시 시도하세요.'});next();});
 const limiter=(limit,windowMs)=>rateLimits?rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.'}}):(_q,_s,n)=>n();
 const loginLimit=limiter(10,15*60*1000),uploadLimit=limiter(150,10*60*1000);
 const admin=sessionGuard(db);
 app.post('/api/login',loginLimit,async(req,res)=>{const {username,password}=req.body||{};if(typeof username!=='string'||typeof password!=='string'||username.length>40||password.length>200)fail(400,'아이디와 비밀번호를 확인하세요.');const row=db.prepare('SELECT * FROM admins WHERE username=?').get(username);const ok=await checkPassword(password,row?.passwordHash);if(!row||!ok)fail(401,'아이디 또는 비밀번호가 올바르지 않습니다.');const raw=token(),csrf=token();db.prepare('DELETE FROM sessions WHERE expiresAt<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(raw),username,csrf,Date.now()+2*60*60*1000);res.cookie('assignment_session',raw,{httpOnly:true,secure:secureCookies,sameSite:'strict',path:'/',maxAge:2*60*60*1000});audit(db,'login');res.json({csrf,username});});
 app.get('/api/session',admin,(req,res)=>res.json({csrf:req.session.csrf,username:req.session.username}));
 app.use('/api/admin',admin,(req,res,next)=>{if(!['GET','HEAD'].includes(req.method)&&req.get('X-CSRF-Token')!==req.session.csrf)return res.status(403).json({error:'보안 확인이 만료되었습니다. 새로고침 후 다시 시도하세요.'});next();});
 app.post('/api/admin/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(req.session.tokenHash);res.clearCookie('assignment_session',{path:'/'});res.json({ok:true});});
 app.get('/api/public',(_req,res)=>{const settings=db.prepare('SELECT maxMB,retentionDays FROM settings WHERE id=1').get();res.json({classes:db.prepare('SELECT * FROM classes ORDER BY grade,classNo').all(),assignments:db.prepare('SELECT * FROM assignments ORDER BY dueAt DESC').all().map(assignmentView),...settings});});
 const listAssignments=()=>db.prepare('SELECT * FROM assignments ORDER BY id DESC').all().map(assignmentView);
 app.get('/api/admin/assignments',(_req,res)=>res.json(listAssignments()));
 app.post('/api/admin/assignments',(req,res)=>{const data=parse(assignmentSchema,req.body);for(const c of data.classes)if(!db.prepare('SELECT 1 FROM classes WHERE grade=? AND classNo=?').get(data.grade,c))fail(400,'대상 학급을 먼저 등록하세요.');if(data.id&&!db.prepare('SELECT id FROM assignments WHERE id=?').get(data.id))fail(404,'과제를 찾을 수 없습니다.');if(!data.id&&!data.code)fail(400,'6자 이상의 제출 코드를 입력하세요.');const old=data.id?db.prepare('SELECT codeHash FROM assignments WHERE id=?').get(data.id):null;const values=[data.title,data.description,data.grade,JSON.stringify([...new Set(data.classes)]),data.startsAt,data.dueAt,JSON.stringify(data.extensions),data.maxMB,Number(data.allowResubmit),Number(data.allowLate),data.code?digest(data.code):old.codeHash];
 if(data.id){const previous=getAssignment(db,data.id);const has=db.prepare('SELECT 1 FROM submissions WHERE assignmentId=?').get(data.id);if(has&&(previous.grade!==data.grade||previous.classes.some(c=>!data.classes.includes(c))))fail(400,'제출 기록이 있는 과제는 기존 대상 학년·반을 제거할 수 없습니다.');db.prepare('UPDATE assignments SET title=?,description=?,grade=?,classes=?,startsAt=?,dueAt=?,extensions=?,maxMB=?,allowResubmit=?,allowLate=?,codeHash=? WHERE id=?').run(...values,data.id);audit(db,'assignment_update',data.id);res.json({id:data.id});}
 else{const r=db.prepare('INSERT INTO assignments(title,description,grade,classes,startsAt,dueAt,extensions,maxMB,allowResubmit,allowLate,codeHash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...values);const id=Number(r.lastInsertRowid);audit(db,'assignment_create',id);res.status(201).json({id});}});
 app.get('/api/admin/classes',(_req,res)=>res.json(db.prepare('SELECT * FROM classes ORDER BY grade,classNo').all()));
 app.post('/api/admin/classes',(req,res)=>{const c=parse(classSchema,req.body);const max=db.prepare('SELECT MAX(number) AS n FROM students WHERE grade=? AND classNo=?').get(c.grade,c.classNo).n||0;if(c.maxNumber<max)fail(400,'등록된 학생 번호보다 최대 번호를 작게 할 수 없습니다.');db.prepare('INSERT INTO classes VALUES(?,?,?) ON CONFLICT(grade,classNo) DO UPDATE SET maxNumber=excluded.maxNumber').run(c.grade,c.classNo,c.maxNumber);audit(db,'class_update');res.json({ok:true});});
 function checkClass(s){const c=db.prepare('SELECT * FROM classes WHERE grade=? AND classNo=?').get(s.grade,s.classNo);if(!c||s.number>c.maxNumber)fail(400,'학년·반·번호가 학급 설정 범위와 다릅니다.');}
 app.get('/api/admin/students',(_req,res)=>res.json(db.prepare('SELECT * FROM students ORDER BY grade,classNo,number').all()));
 app.post('/api/admin/students',(req,res)=>{const s=parse(studentSchema,req.body);checkClass(s);if(s.id){const r=db.prepare('UPDATE students SET grade=?,classNo=?,number=?,name=? WHERE id=?').run(s.grade,s.classNo,s.number,s.name,s.id);if(!r.changes)fail(404,'학생을 찾을 수 없습니다.');}else db.prepare('INSERT INTO students(grade,classNo,number,name) VALUES(?,?,?,?)').run(s.grade,s.classNo,s.number,s.name);audit(db,'student_save',s.id);res.json({ok:true});});
 app.post('/api/admin/students/import',(req,res)=>{if(typeof req.body.csv!=='string'||req.body.csv.length>1024*1024)fail(400,'CSV 파일은 1MB 이내여야 합니다.');let rows;try{rows=parseCsv(req.body.csv,{bom:true,columns:true,skip_empty_lines:true,trim:true});}catch{fail(400,'CSV 형식이 올바르지 않습니다. UTF-8 CSV로 저장하세요.');}if(!rows.length||rows.length>5000)fail(400,'CSV는 1~5,000행까지 등록할 수 있습니다.');const values=rows.map(r=>parse(studentSchema,{grade:Number(r['학년']),classNo:Number(r['반']),number:Number(r['번호']),name:r['이름']}));const seen=new Set();for(const s of values){checkClass(s);const key=`${s.grade}/${s.classNo}/${s.number}`;if(seen.has(key))fail(400,'CSV 안에 중복된 학년·반·번호가 있습니다.');seen.add(key);const current=db.prepare('SELECT name FROM students WHERE grade=? AND classNo=? AND number=?').get(s.grade,s.classNo,s.number);if(current&&current.name!==s.name&&req.body.confirm!=='명단 덮어쓰기')fail(409,'기존 명단의 이름이 달라집니다. 미리 확인한 뒤 명단 덮어쓰기를 승인하세요.');}
 transaction(db,()=>{const q=db.prepare('INSERT INTO students(grade,classNo,number,name) VALUES(?,?,?,?) ON CONFLICT(grade,classNo,number) DO UPDATE SET name=excluded.name');for(const s of values)q.run(s.grade,s.classNo,s.number,s.name);audit(db,'roster_import');});res.json({imported:values.length});});

 const disk=multer.diskStorage({destination:join(dataDir,'tmp'),filename:(_req,_file,cb)=>cb(null,randomUUID())});
 app.post('/api/submissions',uploadLimit,(req,res,next)=>{const max=db.prepare('SELECT maxMB FROM settings WHERE id=1').get().maxMB;multer({storage:disk,limits:{fileSize:max*1024*1024,files:1,fields:1,fieldSize:8192,parts:2},preservePath:false}).single('file')(req,res,next);},async(req,res)=>{
  let finalPath;
  try{
   if(!req.file)fail(400,'제출할 파일을 선택하세요.');
   // Busboy decodes multipart filenames as Latin-1 by default; browsers send UTF-8.
   const raw=req.file.originalname;const decoded=Buffer.from(raw,'latin1').toString('utf8');if(!decoded.includes('\uFFFD'))req.file.originalname=decoded;
   let rawMeta;try{rawMeta=JSON.parse(req.body.metadata);}catch{fail(400,'제출 정보가 올바르지 않습니다. 화면에서 다시 입력하세요.');}
   const s=parse(submissionSchema,rawMeta);checkClass(s);const rawAssignment=db.prepare('SELECT * FROM assignments WHERE id=?').get(s.assignmentId);if(!rawAssignment)fail(404,'과제를 찾을 수 없습니다.');const a=assignmentView(rawAssignment);if(digest(s.code)!==rawAssignment.codeHash)fail(403,'제출 코드가 올바르지 않습니다. 선생님께 확인하세요.');
   if(s.grade!==a.grade||!a.classes.includes(s.classNo))fail(400,'이 학급의 과제가 아닙니다.');
   const globalMax=db.prepare('SELECT maxMB FROM settings WHERE id=1').get().maxMB;
   const sha256=await validateUpload(req.file,{...a,maxMB:Math.min(a.maxMB,globalMax)});
   if(JSON.stringify(db.prepare('SELECT * FROM assignments WHERE id=?').get(s.assignmentId))!==JSON.stringify(rawAssignment)||db.prepare('SELECT maxMB FROM settings WHERE id=1').get().maxMB!==globalMax)fail(409,'검증 중 과제 설정이 바뀌었습니다. 새로고침 후 변경된 조건을 확인하고 다시 제출하세요.');
   // No awaits from policy recheck through transaction: duplicate/revision checks are atomic.
   const now=new Date().toISOString();if(now<a.startsAt)fail(400,'아직 제출 시작 전입니다.');if(now>a.dueAt&&!a.allowLate)fail(400,'제출 마감 시간이 지났습니다. 선생님께 문의하세요.');
   const result=transaction(db,()=>{
    const old=db.prepare('SELECT * FROM submissions WHERE assignmentId=? AND grade=? AND classNo=? AND number=?').get(s.assignmentId,s.grade,s.classNo,s.number);
    let id,receipt=s.receipt;if(old){if(!receipt)fail(409,'이미 제출한 번호입니다. 자신의 제출이라면 기존 확인번호를 입력해 재제출하세요.');if(digest(receipt)!==old.receiptHash)fail(403,'제출 확인번호가 일치하지 않습니다. 다른 학생의 기록은 수정할 수 없습니다.');if(!a.allowResubmit)fail(400,'이 과제는 재제출을 허용하지 않습니다.');id=old.id;}
    else{receipt=token();id=Number(db.prepare('INSERT INTO submissions(assignmentId,grade,classNo,number,name,receiptHash) VALUES(?,?,?,?,?,?)').run(s.assignmentId,s.grade,s.classNo,s.number,s.name,digest(receipt)).lastInsertRowid);}
    const v=(db.prepare('SELECT MAX(version) AS v FROM versions WHERE submissionId=?').get(id).v||0)+1;
    const storageName=randomUUID();finalPath=join(dataDir,'files',storageName);renameSync(req.file.path,finalPath);
    db.prepare('INSERT INTO versions(submissionId,version,originalName,storageName,size,sha256,submittedAt) VALUES(?,?,?,?,?,?,?)').run(id,v,req.file.originalname,storageName,req.file.size,sha256,now);audit(db,'submission_save',id);
    return {id,receipt,version:v,submittedAt:now,title:a.title,filename:req.file.originalname,late:now>a.dueAt};
   });finalPath=undefined;res.status(201).json(result);
  }finally{for(const path of [req.file?.path,finalPath])if(path&&existsSync(path))unlinkSync(path);}
 });
 app.get('/api/admin/report',(req,res)=>res.json(report(db,req.query.assignmentId,req.query)));
 app.get('/api/admin/history/:id',(req,res)=>res.json(db.prepare('SELECT id,version,originalName,size,submittedAt FROM versions WHERE submissionId=? ORDER BY version DESC').all(Number(req.params.id)||0)));
 app.post('/api/admin/receipt/:id',(_req,res)=>res.status(405).json({error:'확인번호는 복구할 수 없습니다. 기존 제출본을 보존하고 새 과제로 제출받으세요.'}));
 app.get('/api/admin/files/:id',(req,res)=>{const v=db.prepare('SELECT v.*,s.grade,s.classNo,s.number,s.name,s.assignmentId FROM versions v JOIN submissions s ON s.id=v.submissionId WHERE v.id=?').get(Number(req.params.id)||0);if(!v)fail(404,'파일을 찾을 수 없습니다.');audit(db,'file_download',v.id);res.set('X-Content-Type-Options','nosniff');const name=`${v.grade}학년_${v.classNo}반_${String(v.number).padStart(2,'0')}_${safePart(v.name)}_${safePart(getAssignment(db,v.assignmentId).title)}_v${v.version}_${safePart(v.originalName)}`;res.download(join(dataDir,'files',v.storageName),name,e=>{if(e&&!res.headersSent)res.status(500).json({error:'저장 파일을 읽지 못했습니다. 백업과 서버 저장소를 확인하세요.'});});});
 app.get('/api/admin/report.csv',(req,res)=>{const r=report(db,req.query.assignmentId,req.query);res.attachment(`${safePart(r.assignment.title)}_제출현황.csv`).type('text/csv').send(csvReport(r));});
 app.get('/api/admin/export.zip',(req,res)=>{const r=report(db,req.query.assignmentId,req.query);const files=r.rows.filter(s=>s.fileId);if(!files.length)fail(400,'다운로드할 제출 파일이 없습니다.');for(const v of files)if(!existsSync(join(dataDir,'files',v.storageName)))fail(500,'저장소에서 일부 파일을 찾지 못했습니다. 백업을 확인하세요.');audit(db,'zip_download',r.assignment.id);res.attachment(`${safePart(r.assignment.title)}_과제.zip`);const zip=archiver('zip',{zlib:{level:3}});zip.on('error',()=>res.destroy());res.on('close',()=>zip.abort());zip.pipe(res);for(const v of files)zip.file(join(dataDir,'files',v.storageName),{name:exportName(r.assignment,v)});zip.append(csvReport(r),{name:`${safePart(r.assignment.title)}_과제/제출현황.csv`});zip.finalize();});
 app.get('/api/admin/settings',(_req,res)=>res.json(db.prepare('SELECT * FROM settings WHERE id=1').get()));
 app.post('/api/admin/settings',(req,res)=>{const s=parse(settingsSchema,req.body);db.prepare('UPDATE settings SET maxMB=?,retentionDays=? WHERE id=1').run(s.maxMB,s.retentionDays);audit(db,'settings_update');res.json({ok:true});});
 app.get('/api/admin/audit',(_req,res)=>res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()));
 app.post('/api/admin/backup',async(_req,res)=>{backingUp=true;try{const name=`backup-${Date.now()}-${randomUUID()}.zip`;await createBackup(dataDir,join(dataDir,'backups',name));audit(db,'backup_create');res.json({name});}finally{backingUp=false;}});
 app.get('/api/admin/backup/:name',(req,res)=>{if(!/^backup-\d+-[a-f0-9-]{36}\.zip$/.test(req.params.name))fail(400,'백업 파일명이 올바르지 않습니다.');const path=join(dataDir,'backups',req.params.name);if(!existsSync(path))fail(404,'백업 파일을 찾지 못했습니다.');res.download(path,req.params.name);});
 app.post('/api/admin/purge',(req,res)=>{if(req.body.confirm!=='보유기간 지난 자료 삭제')fail(400,'삭제 확인 문구를 정확히 입력하세요. 먼저 백업을 만드세요.');const days=db.prepare('SELECT retentionDays FROM settings WHERE id=1').get().retentionDays;const cutoff=new Date(Date.now()-days*86400000).toISOString();const ids=db.prepare('SELECT s.id FROM submissions s WHERE (SELECT MAX(submittedAt) FROM versions WHERE submissionId=s.id)<?').all(cutoff).map(s=>s.id);const files=ids.flatMap(id=>db.prepare('SELECT storageName FROM versions WHERE submissionId=?').all(id));transaction(db,()=>{for(const id of ids)db.prepare('DELETE FROM submissions WHERE id=?').run(id);audit(db,'retention_purge');});let remaining=0;for(const f of files){try{unlinkSync(join(dataDir,'files',f.storageName));}catch{remaining++;}}res.json({deleted:ids.length,remainingFiles:remaining});});
 const dist=resolve(fileURLToPath(new URL('../dist',import.meta.url)));app.use(express.static(dist,{index:false}));
 app.get(['/', '/teacher'],(_req,res)=>{if(existsSync(join(dist,'index.html')))res.sendFile(join(dist,'index.html'));else res.status(503).send('먼저 pnpm build를 실행하거나 개발용 Vite 화면을 여세요.');});
 app.use((_req,res)=>res.status(404).json({error:'요청한 주소를 찾을 수 없습니다.'}));
 app.use((err,req,res,_next)=>{if(req.file?.path&&existsSync(req.file.path)){try{unlinkSync(req.file.path);}catch{}}if(res.headersSent)return res.destroy();if(err instanceof multer.MulterError)return res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:err.code==='LIMIT_FILE_SIZE'?'파일 용량 제한을 초과했습니다. 크기를 줄여 다시 제출하세요.':'파일 한 개와 제출 정보만 보내세요.'});if(err instanceof AppError)return res.status(err.status).json({error:err.message});if(err.code?.startsWith('SQLITE_CONSTRAINT'))return res.status(409).json({error:'이미 등록된 학년·반·번호입니다. 기존 정보를 확인하세요.'});if(err.type==='entity.too.large')return res.status(413).json({error:'요청 내용이 너무 큽니다.'});if(err instanceof SyntaxError)return res.status(400).json({error:'요청 형식이 올바르지 않습니다.'});res.status(500).json({error:'서버에 저장하거나 처리하지 못했습니다. 성공한 것으로 간주하지 말고 선생님께 문의하세요. 서버 저장 공간과 권한을 확인해야 합니다.'});});
 return {app,db,close:()=>db.close()};
}
