import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCb);
export const token=()=>randomBytes(24).toString('base64url');
export const digest=value=>createHash('sha256').update(String(value)).digest('hex');
export async function hashPassword(value){const salt=randomBytes(16).toString('hex');const key=await scrypt(value,salt,64);return `${salt}:${key.toString('hex')}`;}
export async function checkPassword(value,stored){const [salt,hex]=(stored||'00000000000000000000000000000000:'+'0'.repeat(128)).split(':');const key=await scrypt(value,salt,64);const expected=Buffer.from(hex,'hex');return expected.length===key.length&&timingSafeEqual(key,expected);}
export async function provisionAdmin(db,username,password){if(!/^[a-zA-Z0-9_-]{3,40}$/.test(username)||password.length<12||password.length>200)throw new Error('아이디는 영문/숫자 3~40자, 비밀번호는 12~200자로 설정하세요.');const hash=await hashPassword(password);db.prepare('INSERT INTO admins VALUES(?,?) ON CONFLICT(username) DO UPDATE SET passwordHash=excluded.passwordHash').run(username,hash);db.prepare('DELETE FROM sessions WHERE username=?').run(username);}
export function sessionGuard(db){return(req,res,next)=>{const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('assignment_session='))?.slice(19);if(!raw)return res.status(401).json({error:'교사 로그인이 필요합니다.'});const session=db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expiresAt>?').get(digest(raw),Date.now());if(!session)return res.status(401).json({error:'로그인 시간이 지났습니다. 다시 로그인하세요.'});req.session=session;next();};}
