import { z } from 'zod';
export const allExtensions=['.ent','.py','.txt','.pdf','.hwp','.hwpx','.docx','.pptx','.xlsx','.jpg','.jpeg','.png','.zip'];
export class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
export function fail(status,message){throw new AppError(status,message);}
const integer=(min,max)=>z.number().int().min(min).max(max);
const safeName=z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} .·_-]+$/u);
export const studentSchema=z.object({id:integer(1,1e9).optional(),grade:integer(1,6),classNo:integer(1,50),number:integer(1,100),name:safeName});
export const classSchema=z.object({grade:integer(1,6),classNo:integer(1,50),maxNumber:integer(1,100)});
export const assignmentSchema=z.object({id:integer(1,1e9).optional(),title:z.string().trim().min(1).max(100),description:z.string().max(3000).default(''),grade:integer(1,6),classes:z.array(integer(1,50)).min(1).max(50),startsAt:z.iso.datetime(),dueAt:z.iso.datetime(),extensions:z.array(z.enum(allExtensions)).min(1),maxMB:integer(1,500),allowResubmit:z.boolean(),allowLate:z.boolean(),code:z.string().min(6).max(100).optional()}).refine(x=>x.dueAt>x.startsAt,{message:'마감일은 시작일 뒤여야 합니다.'});
export const submissionSchema=studentSchema.omit({id:true}).extend({assignmentId:integer(1,1e9),code:z.string().max(100),receipt:z.string().max(100).optional()});
export const settingsSchema=z.object({maxMB:integer(1,500),retentionDays:integer(1,3650)});
export function parse(schema,value){const result=schema.safeParse(value);if(!result.success)fail(400,'입력 내용을 확인하세요. 날짜·번호·필수 항목 또는 허용 범위가 올바르지 않습니다.');return result.data;}
export const assignmentView=row=>({...row,classes:JSON.parse(row.classes),extensions:JSON.parse(row.extensions),allowResubmit:!!row.allowResubmit,allowLate:!!row.allowLate,codeHash:undefined});
export const safePart=value=>String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/\.{2,}/g,'_').replace(/[. ]+$/g,'').slice(0,80)||'파일';
