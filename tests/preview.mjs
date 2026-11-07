// Local browser QA fixture only. Does not use the operator's normal data directory.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { provisionAdmin, digest } from '../server/auth.mjs';
if(process.argv[2]!=='--fake-data-only')throw new Error('Use --fake-data-only for isolated local QA.');
const dataDir=mkdtempSync(join(tmpdir(),'과제함 UI 가상 '));
const ctx=createApp({dataDir,origin:'http://127.0.0.1:4310',secureCookies:false});
await provisionAdmin(ctx.db,'demo_teacher','Only-Fake-Data-2026!');
ctx.db.prepare('INSERT INTO assignments(title,description,grade,classes,startsAt,dueAt,extensions,maxMB,allowResubmit,allowLate,codeHash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('파이썬 조건문 실습','조건문을 활용한 프로그램을 만들고 .py 파일로 제출해 주세요.',1,'[1,2,3,4,5,6,7,8,9,10]','2020-01-01T00:00:00.000Z','2099-12-31T00:00:00.000Z','[".py",".txt"]',50,1,0,digest('practice123'));
const q=ctx.db.prepare('INSERT INTO students(grade,classNo,number,name) VALUES(1,?,?,?)');for(let c=1;c<=10;c++)for(let n=1;n<=30;n++)q.run(c,n,`가상학생${String(n).padStart(2,'0')}`);
const s=ctx.app.listen(4310,'127.0.0.1',()=>console.log('QA fixture ready http://127.0.0.1:4310; fictional data only'));
process.on('SIGINT',()=>s.close(()=>{ctx.close();process.exit(0);}));
