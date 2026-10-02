import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { api } from '@appdeploy/client';
import './index.css';
import App from './App.tsx';

function Bootstrap(){
  const [key,setKey]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;api.post('/api/auth/config',{}).then(r=>{const k=r.data?.publishableKey;if(active&&k)setKey(k);else if(active)setError('Clerk authentication is not configured yet.')}).catch(e=>{if(active)setError(e?.message||'Could not initialize authentication.')});return()=>{active=false}},[]);
  if(error)return <div className="authpage"><div className="authcard"><div className="authbrand"><span className="brandmark">S</span><b>SignalDesk</b></div><div className="sectiontag">AUTHENTICATION</div><h1>SignalDesk is starting up.</h1><p>{error}</p><button className="primary full big" onClick={()=>window.location.reload()}>Retry</button></div></div>;
  if(!key)return <div className="authpage"><div className="authcard" style={{textAlign:'center'}}><div className="authbrand"><span className="brandmark">S</span><b>SignalDesk</b></div><div className="sectiontag">SECURE ACCESS</div><h1>Connecting to Clerk…</h1><p>Preparing secure authentication for your workspace.</p><div className="primary full" style={{marginTop:20}}>Loading…</div></div></div>;
  return <ClerkProvider publishableKey={key} signInUrl="/sign-in" signUpUrl="/sign-up" signInForceRedirectUrl="/" signUpForceRedirectUrl="/" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" afterSignOutUrl="/" appearance={{theme:'simple',variables:{colorPrimary:'#19a974',colorForeground:'#111111',colorBackground:'#ffffff',colorInputBackground:'#ffffff',borderRadius:'14px'}}}><App/></ClerkProvider>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Bootstrap/></React.StrictMode>);
