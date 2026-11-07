import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPages} from '../scripts/build-pages.mjs';
test('Pages에는 개인정보 입력·전송 없이 서버 연결 상태만 안내',()=>{const dir=mkdtempSync(join(tmpdir(),'pages-safe-'));try{buildPages({outputDir:dir});const html=readFileSync(join(dir,'index.html'),'utf8');assert.match(html,/학교 서버 연결 대기/);assert.doesNotMatch(html,/<(?:form|input|script|iframe)\b/i);assert.doesNotMatch(html,/href="https?:/);assert.match(html,/아직 과제를 제출할 수 없습니다/);}finally{rmSync(dir,{recursive:true,force:true});}});
test('학교 서버는 HTTPS·인증정보 없는 주소만 허용',()=>{const dir=mkdtempSync(join(tmpdir(),'pages-link-'));try{for(const url of ['http://example.com','javascript:alert(1)','https://user:password@example.com','https://example.com/?token=secret'])assert.throws(()=>buildPages({outputDir:dir,serverUrl:url}));buildPages({outputDir:dir,serverUrl:'https://school.example.com'});const html=readFileSync(join(dir,'index.html'),'utf8');assert.match(html,/href="https:\/\/school.example.com\/teacher"/);assert.doesNotMatch(html,/학교 서버 연결 대기/);}finally{rmSync(dir,{recursive:true,force:true});}});
