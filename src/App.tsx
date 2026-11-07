import React from 'react';
import { FolderUp } from 'lucide-react';
import Student from './Student';
import Teacher from './Teacher';
export default function App(){return <><a className="skip" href="#main">본문으로 이동</a>{location.pathname==='/teacher'?<Teacher/>:<><header className="site-header"><a className="brand" href="/"><span className="brand-icon"><FolderUp size={24}/></span>정보 과제 제출함</a><a className="text-link" href="/teacher">교사 관리 화면 →</a></header><Student/><footer>정보 수업의 완성, 안전한 과제 제출로.<span>파일은 선생님만 확인할 수 있어요.</span></footer></>}</>;}
