const PRODUCTION_API_URL='https://securechat-api-uogx.onrender.com';
const isLocalHost=typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname);
export const API_URL=import.meta.env.VITE_API_URL||(isLocalHost?'http://localhost:8080':PRODUCTION_API_URL);
export const getToken=()=>localStorage.getItem('sc_token');
// File downloads go over <img>/<video>/<audio> src attributes, which can't carry an
// Authorization header, so a token has to ride in the URL. Reusing the 30-day session
// JWT there would mean it ends up in browser history, proxy/CDN access logs, and any
// Referer header — so file links use a separate, short-lived (15 min), single-purpose
// token instead. See ensureFileToken()/resolveFileUrl() below and GET /api/files/token.
let fileTokenCache=null; // {token, expiresAt}
let fileTokenPromise=null;
export async function ensureFileToken(){
  if(!getToken())return null;
  if(fileTokenCache&&fileTokenCache.expiresAt-Date.now()>60000)return fileTokenCache.token;
  if(fileTokenPromise)return fileTokenPromise;
  fileTokenPromise=api('/api/files/token',{method:'POST'})
    .then(d=>{fileTokenCache={token:d.token,expiresAt:Date.now()+(d.expiresIn||600)*1000};return fileTokenCache.token})
    .catch(()=>null)
    .finally(()=>{fileTokenPromise=null});
  return fileTokenPromise;
}
export const resolveFileUrl=value=>{
  if(!value)return'';
  if(/^(https?:|data:|blob:)/i.test(value))return value;
  if(!fileTokenCache||fileTokenCache.expiresAt-Date.now()<=60000)ensureFileToken();
  const token=fileTokenCache?.token;
  return API_URL+value+(token?'?token='+encodeURIComponent(token):'')
};
export const getStoredUser=()=>{try{return JSON.parse(localStorage.getItem('sc_user')||'null')}catch{return null}};
export const setSession=(token,user)=>{localStorage.setItem('sc_token',token);localStorage.setItem('sc_user',JSON.stringify(user))};
export const clearSession=()=>{localStorage.removeItem('sc_token');localStorage.removeItem('sc_user');fileTokenCache=null;fileTokenPromise=null};
export async function api(path,options={}){const headers={...(options.headers||{})}; if(!(options.body instanceof FormData))headers['Content-Type']='application/json'; const token=getToken(); if(token)headers.Authorization='Bearer '+token; const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),60000); try{const res=await fetch(API_URL+path,{...options,headers,signal:options.signal||controller.signal}); let data={}; try{data=await res.json()}catch{} if(res.status===401)clearSession(); if(!res.ok){const err=new Error(data.error||'Request failed'); Object.assign(err,data); throw err} return data}catch(error){if(error.name==='AbortError')throw new Error('The server took too long to respond. Please try again.'); if(error instanceof TypeError)throw new Error('Could not reach the server. Check your connection and try again.'); throw error}finally{clearTimeout(timeout)}}
export async function uploadFile(file){const form=new FormData(); form.append('file',file); return api('/api/upload',{method:'POST',body:form,headers:{}})}
