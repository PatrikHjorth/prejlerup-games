'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Profile = { id:string; display_name:string; credits:number; is_admin:boolean }
type Option = { id:string; label:string }
type Challenge = { id:string; title:string; description:string|null; status:'upcoming'|'open'|'locked'|'finished'; winner_option_id:string|null; challenge_options:Option[] }
type Bet = { id:string; challenge_id:string; option_id:string; stake:number; locked_odds:number }
type Notice = { id:string; title:string; message:string; created_at:string }

function usernameToEmail(name: string) {
  const username = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]/g, '')

  if (username === 'admin') {
    return 'kontakt@prejlerupridning.dk'
  }

  return `${username}@players.prejlerup.dk`
}

const supabase = createClient()

export default function Home(){
  const [profile,setProfile]=useState<Profile|null>(null)
  const [sessionReady,setSessionReady]=useState(false)
  const [challenges,setChallenges]=useState<Challenge[]>([])
  const [bets,setBets]=useState<Bet[]>([])
  const [notices,setNotices]=useState<Notice[]>([])
  const [tab,setTab]=useState('spil')
  const [selected,setSelected]=useState('')
  const [stake,setStake]=useState(100)
  const [message,setMessage]=useState('')

  async function load(){
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user){ setProfile(null); setSessionReady(true); return }
    const [{data:p},{data:c},{data:b},{data:n}] = await Promise.all([
      supabase.from('profiles').select('*').eq('id',user.id).single(),
      supabase.from('challenges').select('*,challenge_options(id,label)').order('created_at'),
      supabase.from('bets').select('*').eq('player_id',user.id),
      supabase.from('notifications').select('*').order('created_at',{ascending:false})
    ])
    setProfile(p)
    setChallenges((c||[]) as Challenge[])
    setBets((b||[]) as Bet[])
    setNotices((n||[]) as Notice[])
    setSessionReady(true)
  }

  useEffect(()=>{
    load()
    const channel=supabase.channel('prejlerup-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'challenges'},load)
      .on('postgres_changes',{event:'*',schema:'public',table:'challenge_options'},load)
      .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},load)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications'},load)
      .subscribe()
    return ()=>{ supabase.removeChannel(channel) }
  },[])

  const active=useMemo(()=>challenges.find(c=>c.status==='open'||c.status==='locked')||challenges[0], [challenges])
  useEffect(()=>{ if(active?.challenge_options?.length && !active.challenge_options.some(o=>o.id===selected)) setSelected(active.challenge_options[0].id) },[active,selected])

  const alreadyBet=active ? bets.some(b=>b.challenge_id===active.id) : false
  const odds=2.0

  async function placeBet(){
    if(!profile||!active||!selected) return
    if(stake<10||stake>profile.credits){ setMessage('Kontrollér indsats og saldo.'); return }
    const {error}=await supabase.rpc('place_bet',{p_challenge_id:active.id,p_option_id:selected,p_stake:stake,p_odds:odds})
    setMessage(error?error.message:'Din prediction er placeret.')
    await load()
  }

  if(!sessionReady) return <main className="loading">Indlæser…</main>

  return <div className="app">
    <img className="hero" src="/prejlerup.jpg" alt="Prejlerup Ridning" />
    <header><h1>PREJLERUP<br/>GAMES</h1><p>Live predictions og virtuelle credits</p></header>
    <nav>{['spil','stilling','profil','beskeder',...(profile?.is_admin?['admin']:[])].map(x=><button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}>{x}</button>)}</nav>
    <main>
      {message&&<div className="notice">{message}</div>}
      {tab==='spil' && <section>
        {!profile ? <div className="card"><h2>Log ind for at spille</h2><button onClick={()=>setTab('profil')}>Gå til profil</button></div> : !active ? <div className="card">Ingen dyst er oprettet endnu.</div> : <>
          <div className="dark card"><span className="badge">{active.status.toUpperCase()}</span><h2>{active.title}</h2><p>{active.description}</p></div>
          <div className="options">{active.challenge_options.map(o=><button key={o.id} className={selected===o.id?'selected':''} onClick={()=>setSelected(o.id)}><strong>{o.label}</strong><span>Odds {odds.toFixed(2)}</span></button>)}</div>
          <div className="card"><label>Indsats<input type="number" min={10} value={stake} onChange={e=>setStake(Number(e.target.value))}/></label><p>Mulig udbetaling: <strong>{Math.round(stake*odds)} credits</strong></p><button disabled={active.status!=='open'||alreadyBet} onClick={placeBet}>Placér prediction</button></div>
        </>}
      </section>}
      {tab==='stilling' && <Leaderboard/>}
      {tab==='profil' && <Auth profile={profile} reload={load}/>} 
      {tab==='beskeder' && <section><h2>Beskeder</h2>{notices.map(n=><article className="card" key={n.id}><strong>{n.title}</strong><p>{n.message}</p><small>{new Date(n.created_at).toLocaleString('da-DK')}</small></article>)}</section>}
      {tab==='admin' && profile?.is_admin && <Admin challenges={challenges} reload={load} />}
    </main>
  </div>
}

function Auth({profile,reload}:{profile:Profile|null,reload:()=>Promise<void>}){
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState('')
  async function signUp(e:FormEvent){ e.preventDefault(); const {error}=await supabase.auth.signUp({email,password,options:{data:{display_name:name}}}); alert(error?.message||'Profil oprettet. Kontrollér eventuelt din e-mail.'); await reload() }
  async function signIn(){ const {error}=await supabase.auth.signInWithPassword({email,password}); alert(error?.message||'Logget ind'); await reload() }
  if(profile) return <div className="card"><h2>{profile.display_name}</h2><p><strong>{profile.credits}</strong> credits</p><button onClick={async()=>{await supabase.auth.signOut(); location.reload()}}>Log ud</button></div>
  return <form className="card" onSubmit={signUp}><h2>Opret profil</h2><label>Navn<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>E-mail<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Adgangskode<input required minLength={6} type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><div className="actions"><button type="submit">Opret profil</button><button type="button" className="secondary" onClick={signIn}>Log ind</button></div></form>
}

function Leaderboard(){
 const [rows,setRows]=useState<Profile[]>([])
 useEffect(()=>{ supabase.from('profiles').select('id,display_name,credits,is_admin').order('credits',{ascending:false}).then(({data})=>setRows((data||[]) as Profile[])) },[])
 return <section><h2>Leaderboard</h2>{rows.map((p,i)=><div className="row" key={p.id}><strong>#{i+1} {p.display_name}</strong><strong>{p.credits} credits</strong></div>)}</section>
}

function Admin({challenges,reload}:{challenges:Challenge[],reload:()=>Promise<void>}){
 const [title,setTitle]=useState(''); const [description,setDescription]=useState(''); const [options,setOptions]=useState(['',''])
 const [creditUser,setCreditUser]=useState(''); const [amount,setAmount]=useState(500); const [profiles,setProfiles]=useState<Profile[]>([])
 const [noticeTitle,setNoticeTitle]=useState(''); const [noticeMessage,setNoticeMessage]=useState('')
 useEffect(()=>{ supabase.from('profiles').select('*').order('display_name').then(({data})=>setProfiles((data||[]) as Profile[])) },[])
 async function createChallenge(){ const labels=options.map(x=>x.trim()).filter(Boolean); if(!title||labels.length<2)return alert('Mindst 2 valgmuligheder.'); const {data,error}=await supabase.from('challenges').insert({title,description,status:'upcoming'}).select().single(); if(error)return alert(error.message); await supabase.from('challenge_options').insert(labels.map((label,position)=>({challenge_id:data.id,label,position}))); setTitle('');setDescription('');setOptions(['','']);await reload() }
 async function setStatus(id:string,status:string){ await supabase.from('challenges').update({status}).eq('id',id); await reload() }
 async function finish(id:string,winner:string){ const {error}=await supabase.rpc('finish_challenge',{p_challenge_id:id,p_winner_option_id:winner}); alert(error?.message||'Vinder registreret'); await reload() }
 async function giveCredits(){ const {error}=await supabase.rpc('admin_add_credits',{p_player_id:creditUser,p_amount:amount}); alert(error?.message||'Credits tildelt'); await reload() }
 async function del(id:string){ if(!confirm('Slet spilleren og alle bets?'))return; const {error}=await supabase.rpc('admin_delete_player',{p_player_id:id}); alert(error?.message||'Spiller slettet'); location.reload() }
 async function sendNotice(){ const {error}=await supabase.from('notifications').insert({title:noticeTitle,message:noticeMessage}); alert(error?.message||'Besked sendt'); setNoticeTitle('');setNoticeMessage('') }
 return <section><div className="card"><h2>Opret dyst</h2><label>Navn<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Beskrivelse<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label>{options.map((o,i)=><div className="optionInput" key={i}><input placeholder={`Valgmulighed ${i+1}`} value={o} onChange={e=>setOptions(options.map((x,j)=>j===i?e.target.value:x))}/><button className="danger" disabled={options.length<=2} onClick={()=>setOptions(options.filter((_,j)=>j!==i))}>Fjern</button></div>)}<div className="actions"><button className="secondary" onClick={()=>setOptions([...options,''])}>+ Valgmulighed</button><button onClick={createChallenge}>Opret dyst</button></div></div>
 {challenges.map(c=><div className="card" key={c.id}><h3>{c.title}</h3><p>{c.status} · {c.challenge_options.length} muligheder</p><div className="actions"><button className="secondary" onClick={()=>setStatus(c.id,'open')}>Åbn</button><button className="secondary" onClick={()=>setStatus(c.id,'locked')}>Luk</button>{c.challenge_options.map(o=><button key={o.id} onClick={()=>finish(c.id,o.id)}>{o.label} vinder</button>)}</div></div>)}
 <div className="card"><h2>Tildel credits</h2><select value={creditUser} onChange={e=>setCreditUser(e.target.value)}><option value="">Vælg spiller</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.display_name}</option>)}</select><input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))}/><button onClick={giveCredits}>Tildel</button></div>
 <div className="card"><h2>Send besked</h2><input placeholder="Overskrift" value={noticeTitle} onChange={e=>setNoticeTitle(e.target.value)}/><textarea placeholder="Besked" value={noticeMessage} onChange={e=>setNoticeMessage(e.target.value)}/><button onClick={sendNotice}>Send til alle</button></div>
 <div className="card"><h2>Slet spillere</h2>{profiles.map(p=><div className="row" key={p.id}><span>{p.display_name}</span><button className="danger" onClick={()=>del(p.id)}>Slet</button></div>)}</div></section>
}
