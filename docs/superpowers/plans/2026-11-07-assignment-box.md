# 정보 과제 제출함 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** 학생 제출부터 교사 학급별 ZIP 다운로드까지 작동하는 학교 내부 웹사이트.
**Architecture:** 단일 Node 서버, React UI, SQLite 및 비공개 파일 저장. 외부 게시 없음.
**Tech Stack:** React, TypeScript, Tailwind, Express, SQLite, Multer, Archiver.
**Spec:** ../../design.md

## Global Constraints
가상 자료만 테스트, 관리자 인증/서버 권한 검사, 파일 비공개, 50MB 기본, 재제출 확인번호, HTTPS 운영, 원본 보존.

## Review Focus
동일 번호 경쟁 제출, 악성/경로 조작 파일, 명단 없는 미제출 오표기, 백업 복원 손실, 업로드 실패 성공 오표시.

### Task 1: 저장·인증·핵심 제출
Files: server/db.mjs, server/app.mjs, server/files.mjs, tests/api.test.mjs.
Interfaces: createApp({dataDir,origin,secureCookies,rateLimits}) → {app,db,close}; provisionAdmin(db,user,password).
- [ ] 테스트를 먼저 작성하고 미구현 실패 확인.
- [ ] scrypt 관리자/세션·CSRF·과제·파일 검증·학생 제출/다운로드 구현.
- [ ] 실제 파일·SQLite API 테스트 통과 확인.

### Task 2: 현황·명단·이력·ZIP·백업
Files: server/reports.mjs, scripts/backup.mjs, scripts/restore.mjs, tests/api.test.mjs, tests/backup.test.mjs.
Interfaces: report(db,assignmentId), createBackup(dataDir,destination), restoreBackup(archive,target).
- [ ] 명단 기반 현황, 경쟁 제출, 재제출·마감·ZIP·32개 동시 제출·재시작·복원 테스트 먼저 작성.
- [ ] CSV 명단·학급·검색·정렬·보유기간 삭제·백업 복원 구현.
- [ ] 전체 API 테스트 실행.

### Task 3: 학생/교사 화면과 배포
Files: src/*.tsx, src/styles.css, server/start.mjs, docs/*.md.
Interfaces: 상대경로 /api, 쿠키 세션 및 X-CSRF-Token, multipart 단일 file.
- [ ] 학생/교사 초기 화면 테스트 실패 확인.
- [ ] 한국어 화면과 모든 요청 API 연결, 진행/오류/빈 상태·확인 단계 구현.
- [ ] UI 테스트 및 TypeScript·Vite 빌드.
- [ ] 브라우저 확인, 배포/교사용 안내·라이선스·실제 검증 보고 작성.
