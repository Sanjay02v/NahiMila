// Reverse proxies and a 0.0.0.0 dev binding can give Request.url an internal host.
// Match browser Origin against the HTTP Host actually addressed by the client.
export function assertSameOrigin(req:Request){
 const raw=req.headers.get('origin');if(!raw)return;
 const url=new URL(req.url),origin=new URL(raw);
 const host=req.headers.get('host')||url.host;
 const protocol=req.headers.get('x-forwarded-proto')?.split(',')[0].trim()||url.protocol.slice(0,-1);
 if(origin.host!==host||origin.protocol!==`${protocol}:`)throw new Error('Cross-origin changes are not accepted.');
}
