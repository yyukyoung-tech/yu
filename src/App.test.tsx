import React from 'react';
import { afterEach, test, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import App from './App';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
test('학생 제출 첫 화면과 서버 오류 안내',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('서버에 연결할 수 없습니다.')));render(<App/>);expect(screen.getByRole('heading',{name:'정보 과제 제출함'})).toBeTruthy();expect(await screen.findByText(/서버에 연결할 수 없습니다/)).toBeTruthy();});
