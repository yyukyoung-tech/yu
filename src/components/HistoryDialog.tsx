import React, {useEffect,useRef} from 'react';
import {date} from '../api';
export default function HistoryDialog({versions,onClose}:{versions:any[];onClose:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);return <dialog ref={ref} onCancel={onClose} className="card modal" aria-label="제출 이력"><h2>제출 이력</h2>{versions.map(v=><p key={v.id}>v{v.version} · {date(v.submittedAt)}<br/><a href={`/api/admin/files/${v.id}`}>{v.originalName} 다운로드</a></p>)}<button autoFocus onClick={onClose}>닫기</button></dialog>;}
