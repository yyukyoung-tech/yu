import { resolve } from 'node:path';
import { defaultDataDir } from '../server/db.mjs';
import { createBackup } from '../server/backup.mjs';
if(!process.argv[2])throw new Error('사용법: pnpm backup 새백업파일.zip');
await createBackup(defaultDataDir(),resolve(process.argv[2]));console.log('백업 완료. 학생 정보가 포함되므로 학교 승인 저장소에 안전하게 보관하세요.');
