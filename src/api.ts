export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{let response:Response;try{response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});}catch{throw new Error('서버에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.');}const data=await response.json();if(!response.ok)throw new Error(data.error||'처리하지 못했습니다. 다시 시도하세요.');return data;}
export const date=(value?:string)=>value?new Date(value).toLocaleString('ko-KR'):'—';
export const extensions=['.ent','.py','.txt','.pdf','.hwp','.hwpx','.docx','.pptx','.xlsx','.jpg','.jpeg','.png','.zip'];
export type ClassInfo={grade:number;classNo:number;maxNumber:number};
export type Assignment={id:number;title:string;description:string;grade:number;classes:number[];startsAt:string;dueAt:string;extensions:string[];maxMB:number;allowResubmit:boolean;allowLate:boolean;code?:string};
export type PublicData={classes:ClassInfo[];assignments:Assignment[];maxMB:number;retentionDays:number};
