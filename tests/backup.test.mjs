import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.mjs';
import { createBackup, restoreBackup, writeArchive } from '../server/backup.mjs';
test('백업 → 새 폴더 복원, 무결성·기존 폴더 덮어쓰기 방지',async()=>{const root=mkdtempSync(join(tmpdir(),'가상 백업 '));try{const source=join(root,'원본');const db=openDb(source);db.prepare('INSERT INTO students(grade,classNo,number,name) VALUES(1,1,1,?)').run('가상학생');db.close();const archive=join(root,'backup.zip');await createBackup(source,archive);const target=join(root,'복원');await restoreBackup(archive,target);const restored=openDb(target);assert.equal(restored.prepare('SELECT name FROM students').get().name,'가상학생');assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');restored.close();await assert.rejects(()=>restoreBackup(archive,target));writeFileSync(join(root,'invalid.zip'),'invalid');await assert.rejects(()=>restoreBackup(join(root,'invalid.zip'),join(root,'잘못된복원')));}finally{rmSync(root,{recursive:true,force:true});}});
test('백업 압축 중 파일 누락은 성공 대신 실패',async()=>{const root=mkdtempSync(join(tmpdir(),'백업 누락 '));try{await assert.rejects(()=>writeArchive(join(root,'broken.zip'),[{path:join(root,'missing'),name:'missing'}]));}finally{rmSync(root,{recursive:true,force:true});}});
