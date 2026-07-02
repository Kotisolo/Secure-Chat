export const API_URL=import.meta.env.VITE_API_URL||'http://localhost:8080';
export const getToken=()=>localStorage.getItem('sc_token');
export const getStoredUser=()=>{try{return JSON.parse(localStorage.getItem('sc_user')||'null')}catch{return null}};
export const setSession=(token,user)=>{localStorage.setItem('sc_token',token);localStorage.setItem('sc_user',JSON.stringify(user))};
export const clearSession=()=>{localStorage.removeItem('sc_token');localStorage.removeItem('sc_user')};
export async function api(path,options={}){const headers=options.headers||{}; if(!(options.body instanceof FormData))headers['Content-Type']='application/json'; const token=getToken(); if(token)headers.Authorization='Bearer '+token; const res=await fetch(API_URL+path,{...options,headers}); let data={}; try{data=await res.json()}catch{} if(!res.ok)throw new Error(data.error||'Request failed'); return data}
export async function uploadFile(file){const form=new FormData(); form.append('file',file); return api('/api/upload',{method:'POST',body:form,headers:{}})}
