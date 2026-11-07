import { stringify } from 'csv-stringify/sync';
import { assignmentView, fail, safePart } from './validation.mjs';
export function getAssignment(db,id){const row=db.prepare('SELECT * FROM assignments WHERE id=?').get(Number(id));if(!row)fail(404,'과제를 찾을 수 없습니다.');return assignmentView(row);}
export function report(db,assignmentId,filters={}){
 const assignment=getAssignment(db,assignmentId);const classNo=filters.classNo?Number(filters.classNo):null;
 const roster=db.prepare('SELECT * FROM students WHERE grade=? ORDER BY classNo,number').all(assignment.grade).filter(s=>assignment.classes.includes(s.classNo)&&(!classNo||s.classNo===classNo));
 const submitted=db.prepare(`SELECT s.*,v.id AS fileId,v.originalName,v.submittedAt,v.version,v.storageName,
 (SELECT MIN(submittedAt) FROM versions WHERE submissionId=s.id) AS firstSubmittedAt
 FROM submissions s JOIN versions v ON v.submissionId=s.id
 WHERE s.assignmentId=? AND v.version=(SELECT MAX(version) FROM versions WHERE submissionId=s.id)`).all(assignment.id).filter(s=>!classNo||s.classNo===classNo);
 const key=s=>`${s.grade}/${s.classNo}/${s.number}`;const map=new Map(submitted.map(s=>[key(s),s]));
 const decorate=(s,registered)=>({...s,registered,late:!!s.submittedAt&&s.submittedAt>assignment.dueAt,status:!s.submittedAt?'미제출':s.version>1?'재제출':s.submittedAt>assignment.dueAt?'지각 제출':'제출 완료'});
 const rows=roster.map(s=>{const found=map.get(key(s));map.delete(key(s));return decorate(found?{...s,...found,rosterName:s.name}:s,true);});
 rows.push(...[...map.values()].map(s=>decorate(s,false)));
 const knownSubmitted=rows.filter(s=>s.registered&&s.fileId).length;
 const result={assignment,rosterKnown:roster.length>0,total:roster.length,submitted:submitted.length,registeredSubmitted:knownSubmitted,missing:roster.length?roster.length-knownSubmitted:null,rate:roster.length?Math.round(knownSubmitted/roster.length*100):null,unregistered:rows.filter(s=>!s.registered).length,rows:[],byClass:assignment.classes.map(c=>({classNo:c,total:roster.filter(s=>s.classNo===c).length,submitted:submitted.filter(s=>s.classNo===c).length,registeredSubmitted:rows.filter(s=>s.classNo===c&&s.registered&&s.fileId).length}))};
 let filtered=rows;if(filters.q)filtered=filtered.filter(s=>s.name.includes(String(filters.q))||s.rosterName?.includes(String(filters.q)));
 if(filters.status==='missing')filtered=filtered.filter(s=>!s.fileId);else if(filters.status==='submitted')filtered=filtered.filter(s=>s.fileId);else if(filters.status==='late')filtered=filtered.filter(s=>s.late);else if(filters.status==='resubmit')filtered=filtered.filter(s=>s.version>1);
 filtered.sort(filters.sort==='time'?(a,b)=>(b.submittedAt||'').localeCompare(a.submittedAt||''):(a,b)=>a.classNo-b.classNo||a.number-b.number);
 result.rows=filtered;return result;
}
export function csvReport(result){const clean=x=>typeof x==='string'&&/^[\s]*[=+@-]/.test(x)?`'${x}`:x;return '\uFEFF'+stringify([['학년','반','번호','이름','명단 등록','과제명','최초 제출','최종 제출','상태','지각 여부','버전','원본 파일명'],...result.rows.map(s=>[s.grade,s.classNo,s.number,s.name,s.registered?'등록':'미등록',result.assignment.title,s.firstSubmittedAt||'',s.submittedAt||'',s.status,s.late?'지각':'',s.version||'',s.originalName||''].map(clean))]);}
export function exportName(assignment,s){return `${safePart(assignment.title)}_과제/${s.grade}학년_${s.classNo}반/${String(s.number).padStart(2,'0')}_${safePart(s.name)}_v${s.version}_${safePart(s.originalName)}`;}
