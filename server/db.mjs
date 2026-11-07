import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname, basename, sep } from 'node:path';
import {fileURLToPath} from 'node:url';
import { homedir } from 'node:os';

export function defaultDataDir(){return process.env.DATA_DIR || join(process.env.LOCALAPPDATA || join(homedir(),'.local','share'),'InformationAssignmentBox');}
export function openDb(dataDir){
 let ancestor=resolve(dataDir);const suffix=[];while(!existsSync(ancestor)){suffix.unshift(basename(ancestor));const parent=dirname(ancestor);if(parent===ancestor)throw new Error('데이터 저장 폴더의 경로를 확인하세요.');ancestor=parent;}
 const effective=resolve(realpathSync(ancestor),...suffix);const application=realpathSync(fileURLToPath(new URL('..',import.meta.url)));const inside=relative(application,effective);
 if(inside===''||(!isAbsolute(inside)&&inside!=='..'&&!inside.startsWith('..'+sep)))throw new Error('데이터 저장 폴더는 소스 및 웹 공개 폴더 밖에 지정하세요.');
 mkdirSync(dataDir,{recursive:true});for(const d of ['files','tmp','backups'])mkdirSync(join(dataDir,d),{recursive:true});
 const path=join(dataDir,'data.sqlite');const db=new DatabaseSync(path,{timeout:5000});
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version>1){db.close();throw new Error('이 데이터는 더 최신 프로그램으로 열어야 합니다.');}
 if(version<1){
  if(existsSync(path)){db.exec('PRAGMA wal_checkpoint(TRUNCATE)');copyFileSync(path,join(dataDir,'backups',`before-schema-${Date.now()}.sqlite`));}
  db.exec(`BEGIN;
  CREATE TABLE IF NOT EXISTS classes(grade INTEGER NOT NULL,classNo INTEGER NOT NULL,maxNumber INTEGER NOT NULL,PRIMARY KEY(grade,classNo));
  CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY,grade INTEGER NOT NULL,classNo INTEGER NOT NULL,number INTEGER NOT NULL,name TEXT NOT NULL,UNIQUE(grade,classNo,number));
  CREATE TABLE IF NOT EXISTS assignments(id INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,grade INTEGER NOT NULL,classes TEXT NOT NULL,startsAt TEXT NOT NULL,dueAt TEXT NOT NULL,extensions TEXT NOT NULL,maxMB INTEGER NOT NULL,allowResubmit INTEGER NOT NULL,allowLate INTEGER NOT NULL,codeHash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY,assignmentId INTEGER NOT NULL REFERENCES assignments(id),grade INTEGER NOT NULL,classNo INTEGER NOT NULL,number INTEGER NOT NULL,name TEXT NOT NULL,receiptHash TEXT NOT NULL,UNIQUE(assignmentId,grade,classNo,number));
  CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY,submissionId INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,version INTEGER NOT NULL,originalName TEXT NOT NULL,storageName TEXT NOT NULL UNIQUE,size INTEGER NOT NULL,sha256 TEXT NOT NULL,submittedAt TEXT NOT NULL,UNIQUE(submissionId,version));
  CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY,passwordHash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES admins(username),csrf TEXT NOT NULL,expiresAt INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),maxMB INTEGER NOT NULL,retentionDays INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,targetId INTEGER,createdAt TEXT NOT NULL);
  INSERT OR IGNORE INTO settings VALUES(1,50,365);
  PRAGMA user_version=1; COMMIT;`);
  const insert=db.prepare('INSERT OR IGNORE INTO classes VALUES(1,?,30)');for(let i=1;i<=10;i++)insert.run(i);
 }
 return db;
}
export function audit(db,action,targetId=null){db.prepare('INSERT INTO audit(action,targetId,createdAt) VALUES(?,?,?)').run(action,targetId,new Date().toISOString());}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
