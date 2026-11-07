import {ZipArchive} from 'archiver';
export default function createArchive(format='zip',options={}){if(format!=='zip')throw new Error('ZIP 형식만 지원합니다.');return new ZipArchive(options);}
