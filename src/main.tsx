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
  if(!key)return <div className="authpage"><div className="authcard" style={{textAlign:'center'}}><div className="authbrand"><span className="brandmark">S</span><b>SignalDesk</b></div><div className="sectiontag">SECURE ACCESS</div><h1>Connecting to Clerk…</h1><p>Preparing secure authentication for your workspace.</p><div className="primary full" style={{marginTop:20}}>Loading…</div></div></div>;
  return <RuntimeErrorBoundary><ClerkProvider publishableKey={key} signInUrl="/sign-in" signUpUrl="/sign-up" signInForceRedirectUrl="/" signUpForceRedirectUrl="/" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" afterSignOutUrl="/" appearance={{theme:'simple',variables:{colorPrimary:'#19a974',colorForeground:'#111111',colorBackground:'#ffffff',colorInputBackground:'#ffffff',borderRadius:'14px'}}}><App/></ClerkProvider></RuntimeErrorBoundary>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Bootstrap/></React.StrictMode>);
