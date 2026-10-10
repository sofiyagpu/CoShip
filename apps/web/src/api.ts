export class ApiError extends Error { constructor(public code:string,message:string){super(message);} }
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T> {
  const response=await fetch(`/api${path}`,{credentials:'same-origin',...options,headers:{'content-type':'application/json','x-coship-request':'1',...options.headers}});
  const result=await response.json();
  if(!response.ok)throw new ApiError(result.error?.code||'REQUEST_FAILED',result.error?.message||'Не удалось выполнить запрос');
  return result;
}
export const post=<T=any>(path:string,body:unknown={})=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export const formatDate=(date:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(date));
export function relativeTime(date:string|null){if(!date)return 'Ещё не открывали';const days=Math.floor((Date.now()-new Date(date).getTime())/86400000);return days===0?'Сегодня':days===1?'Вчера':`${days} дн. назад`;}
