import { resolve } from 'node:path';
import { restoreBackup } from '../server/backup.mjs';
if(!process.argv[2]||!process.argv[3])throw new Error('사용법: pnpm restore 백업파일.zip 새복원폴더');
await restoreBackup(resolve(process.argv[2]),resolve(process.argv[3]));console.log('새 폴더 복원 완료. 서버를 종료하고 .env의 DATA_DIR을 복원 폴더로 변경한 뒤 재시작하세요.');
