import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import './index.css';
import App from './App.tsx';

class RuntimeErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}> {
  state={error:''};
  static getDerivedStateFromError(error:any){ return {error:String(error?.message||error||'Unknown runtime error')}; }
  render(){
    if(this.state.error) return <div className="authpage"><div className="authcard"><div className="authbrand"><span className="brandmark">S</span><b>SignalDesk</b></div><div className="sectiontag">RUNTIME ERROR</div><h1>SignalDesk needs a quick refresh.</h1><p style={{wordBreak:'break-word'}}>{this.state.error}</p><button className="primary full big" onClick={()=>window.location.reload()}>Refresh</button></div></div>;
    return this.props.children;
  }
}

function Bootstrap(){
  const [key,setKey]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    fetch('/api/auth/config',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(async r=>{
        const raw=await r.text();
        let data:any;
        try{data=JSON.parse(raw)}catch{throw new Error(`Auth API returned ${r.status} non-JSON response.`)}
        if(!r.ok)throw new Error(data?.message||`Auth API returned ${r.status}.`);
        return data;
      })
      .then(r=>{
        const k=r.data?.publishableKey;
        if(active&&k)setKey(k);
        else if(active)setError('Clerk authentication is not configured yet.');
      })
      .catch(e=>{if(active)setError(e?.message||'Could not initialize authentication.')});
    return()=>{active=false};
  },[]);
  if(error)return <div className="authpage"><div className="authcard"><div className="authbrand"><span className="brandmark">S</span><b>SignalDesk</b></div><div className="sectiontag">AUTHENTICATION</div><h1>SignalDesk is starting up.</h1><p>{error}</p><button className="primary full big" onClick={()=>window.location.reload()}>Retry</button></div></div>;
  if(!key)return <div className="loadingpage leaf-loading"><div className="loadingcard leaf-loading-card"><div className="loadingbrand leaf-loading-brand"><span className="signalmark brandmark" aria-hidden="true"><img src="/resources/logo.png" alt="" onError={e=>{const img=e.currentTarget;const fallback='https://www.image2url.com/r2/default/images/1790747654128-73e2312f-5b44-42cd-be32-296b124099b4.png';if(img.src!==fallback)img.src=fallback}}/></span><div><b>SignalDesk</b><span>BUSINESS, IN BETTER BALANCE</span></div></div><div className="leaf-loader" role="status" aria-label="Loading"><svg viewBox="0 0 120 120" aria-hidden="true"><path className="leaf-stem" d="M60 91 C59 70 64 49 79 29"/><path className="leaf-shape leaf-a" d="M61 70 C37 68 27 53 30 34 C49 35 64 46 61 70Z"/><path className="leaf-shape leaf-b" d="M66 53 C65 31 79 18 99 17 C98 38 85 51 66 53Z"/><path className="leaf-shape leaf-c" d="M59 86 C39 87 25 77 21 61 C41 59 55 69 59 86Z"/></svg></div><h1>Connecting to Clerk<span className="loading-ellipsis">…</span></h1><p>Securely connecting your SignalDesk account.</p></div></div>;
  return <RuntimeErrorBoundary><ClerkProvider publishableKey={key} signInUrl="/sign-in" signUpUrl="/sign-up" signInForceRedirectUrl="/" signUpForceRedirectUrl="/" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" afterSignOutUrl="/" appearance={{theme:'simple',variables:{colorPrimary:'#19a974',colorForeground:'#111111',colorBackground:'#ffffff',colorInputBackground:'#ffffff',borderRadius:'14px'}}}><App/></ClerkProvider></RuntimeErrorBoundary>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Bootstrap/></React.StrictMode>);
