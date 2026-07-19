import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, dbRetry } from './supabase.js'
import { buildPairings, computeStandings } from './swiss.js'
import Papa from 'papaparse'
import {
  Crown, Settings, Shuffle, Trophy, Users, ClipboardCheck,
  Plus, Trash2, ChevronUp, ChevronDown, RefreshCw, Swords,
  AlertTriangle, Lock, Upload, Search, Archive, X, Check, LogOut
} from 'lucide-react'

const TIEBREAK_DEFS = {
  buchholzCut1:{label:'부흐홀츠 컷-1',short:'BH-1'},
  buchholz:{label:'부흐홀츠',short:'BH'},
  sb:{label:'손네본-베르거',short:'SB'},
  wins:{label:'승수',short:'승'},
  directEncounter:{label:'승자승',short:'직접'},
  avgOppRating:{label:'평균 상대 레이팅',short:'평균Rt'},
}
const GROUP_ORDER=['유치부','초등-1','초등-2','초등-3','초등-4','초등-5','초등-6','중고등부','일반부']
const PRESET_GROUPS=GROUP_ORDER
function sortGroups(gs){ return [...(gs||[])].sort((a,b)=>{ const ia=GROUP_ORDER.indexOf(a),ib=GROUP_ORDER.indexOf(b); if(ia===-1&&ib===-1) return a.localeCompare(b,'ko'); if(ia===-1) return 1; if(ib===-1) return -1; return ia-ib }) }

function Btn({children,onClick,variant='primary',disabled,className='',size='md'}){
  const base='inline-flex items-center gap-1.5 rounded-md font-medium transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed select-none'
  const sz={sm:'text-xs px-2.5 py-1.5',md:'text-sm px-3.5 py-2',lg:'text-base px-4 py-2.5'}
  const v={primary:'bg-amber-600 hover:bg-amber-700 text-white',ghost:'bg-slate-100 hover:bg-slate-200 text-slate-700',danger:'bg-rose-100 hover:bg-rose-200 text-rose-700',dark:'bg-slate-800 hover:bg-slate-900 text-white',outline:'border border-slate-300 hover:bg-slate-50 text-slate-700'}
  return <button onClick={onClick} disabled={disabled} className={`${base} ${sz[size]} ${v[variant]} ${className}`}>{children}</button>
}
function Card({children,className=''}){ return <div className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>{children}</div> }
function Badge({children,color='slate'}){
  const c={slate:'bg-slate-100 text-slate-600',amber:'bg-amber-100 text-amber-700',rose:'bg-rose-100 text-rose-700',emerald:'bg-emerald-100 text-emerald-700',blue:'bg-blue-100 text-blue-700'}
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c[color]}`}>{children}</span>
}

/* ──────────── PIN 로그인 화면 ──────────── */
function PinScreen({tournament,onLogin}){
  const [pin,setPin]=useState('')
  const [err,setErr]=useState('')

  const tryLogin=(e)=>{
    e.preventDefault()
    if (pin===tournament.chief_pin){ onLogin('chief'); return }
    if (pin===tournament.referee_pin){ onLogin('referee'); return }
    setErr('PIN이 올바르지 않습니다.'); setPin('')
  }
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <Card className="p-6 max-w-sm w-full text-center space-y-4">
        <Crown size={32} className="text-amber-500 mx-auto"/>
        <h2 className="font-bold text-xl text-slate-800">{tournament.name}</h2>
        <p className="text-sm text-slate-500">PIN을 입력해 접속하세요.<br/><span className="text-xs">심판장 PIN / 심판 PIN</span></p>
        <form onSubmit={tryLogin} className="space-y-3">
          <input type="password" inputMode="numeric" maxLength={10} value={pin} onChange={e=>setPin(e.target.value)} placeholder="PIN 입력" className="w-full border border-slate-300 rounded-lg px-4 py-3 text-center text-xl tracking-widest"/>
          {err&&<p className="text-rose-600 text-sm">{err}</p>}
          <Btn className="w-full justify-center" size="lg">입장</Btn>
        </form>
      </Card>
    </div>
  )
}

/* ──────────── 메인 앱 ──────────── */
export default function App(){
  const [loading,setLoading]=useState(true)
  const [tournaments,setTournaments]=useState([])
  const [tid,setTid]=useState(null)
  const [tournament,setTournament]=useState(null)
  const [role,setRole]=useState(null) // null | 'chief' | 'referee'
  const [tab,setTab]=useState('pairings')
  const [players,setPlayers]=useState([])
  const [toast,setToast]=useState('')
  const [busy,setBusy]=useState(false)

  // 대국/결과 로컬 캐시
  const [pairingsCache,setPairingsCache]=useState({}) // {`${group}::${round}`: []}
  const [resultsCache,setResultsCache]=useState({})   // {`${group}::${round}`: {board: result}}

  // 심판장 전용 상태
  const [viewGroup,setViewGroup]=useState('')
  const [viewRound,setViewRound]=useState(1)
  const [standingsGroup,setStandingsGroup]=useState('')
  const [standingsRound,setStandingsRound]=useState(1)
  const [standingsRows,setStandingsRows]=useState([])

  // 심판 전용 상태
  const [refGroup,setRefGroup]=useState('')
  const [refRound,setRefRound]=useState(1)
  const [refSearch,setRefSearch]=useState('')

  const showToast=(msg,dur=2500)=>{ setToast(msg); setTimeout(()=>setToast(''),dur) }

  const ck=(g,r)=>`${g}::${r}`

  const groups=sortGroups(tournament?.groups||[])
  const effectiveGroups=groups.length?groups:['전체']

  const playersInGroup=useCallback((g)=>{
    if (!g||g==='전체') return players
    return players.filter(p=>p.group_name===g)
  },[players])

  /* ── 초기 로드 ── */
  useEffect(()=>{
    loadTournaments()
  },[])

  const loadTournaments=async()=>{
    setLoading(true)
    const {data}=await dbRetry(()=>supabase.from('tournaments').select('*').order('created_at',{ascending:false}))
    setTournaments(data||[])
    if (data?.length===1){ setTid(data[0].id); setTournament(data[0]) }
    setLoading(false)
  }

  /* 대회 선택 시 선수 로드 */
  useEffect(()=>{
    if (!tid) return
    loadPlayers()
    const t=tournaments.find(t=>t.id===tid)
    if (t){ setTournament(t); setViewGroup((sortGroups(t.groups||[])[0])||'전체'); setStandingsGroup((sortGroups(t.groups||[])[0])||'전체'); setRefGroup((sortGroups(t.groups||[])[0])||'전체') }
  },[tid])

  const loadPlayers=async()=>{
    const {data}=await dbRetry(()=>supabase.from('players').select('*').eq('tournament_id',tid).order('rating',{ascending:false}))
    setPlayers(data||[])
  }

  /* ── 대국/결과 로드 ── */
  const loadRound=useCallback(async(g,r,force=false)=>{
    const key=ck(g,r)
    if (!force && pairingsCache[key]!==undefined) return // 캐시 히트
    const {data:pData}=await dbRetry(()=>supabase.from('pairings').select('*').eq('tournament_id',tid).eq('group_name',g).eq('round',r).order('board'))
    const {data:rData}=await dbRetry(()=>supabase.from('results').select('*').eq('tournament_id',tid).eq('group_name',g).eq('round',r))
    const resMap={}; (rData||[]).forEach(r=>resMap[r.board]={result:r.result,white_warnings:r.white_warnings,white_fouls:r.white_fouls,black_warnings:r.black_warnings,black_fouls:r.black_fouls,note:r.note})
    setPairingsCache(prev=>({...prev,[key]:pData||[]}))
    setResultsCache(prev=>({...prev,[key]:resMap}))
  },[tid,pairingsCache])

  useEffect(()=>{ if(tid&&role&&viewGroup) loadRound(viewGroup,viewRound) },[tid,role,viewGroup,viewRound])
  useEffect(()=>{ if(tid&&role&&refGroup) loadRound(refGroup,refRound) },[tid,role,refGroup,refRound])

  /* ── 실시간 구독 (결과 입력 즉시 반영) ── */
  useEffect(()=>{
    if(!tid||!role) return
    const ch=supabase.channel(`results-${tid}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'results',filter:`tournament_id=eq.${tid}`},(payload)=>{
        const r=payload.new||payload.old
        if(!r) return
        const key=ck(r.group_name,r.round)
        setResultsCache(prev=>{
          const m={...(prev[key]||{})}
          if(payload.eventType==='DELETE') delete m[r.board]
          else m[r.board]={result:r.result,white_warnings:r.white_warnings,white_fouls:r.white_fouls,black_warnings:r.black_warnings,black_fouls:r.black_fouls,note:r.note}
          return {...prev,[key]:m}
        })
      })
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  },[tid,role])

  /* ── 대국 생성 ── */
  const generateRound=async(g,r)=>{
    const gPlayers=playersInGroup(g)
    if(gPlayers.length<2){ showToast(`'${g}' 그룹에 선수가 2명 이상 필요합니다.`); return }
    setBusy(true)
    try {
      // 이전 라운드까지 이력 수집
      const allPairings={},allResults={}
      for(let i=1;i<r;i++){
        await loadRound(g,i)
        allPairings[i]=(pairingsCache[ck(g,i)]||[])
        const rm=resultsCache[ck(g,i)]||{}
        allResults[i]=Object.fromEntries(Object.entries(rm).map(([b,v])=>[b,v.result]))
      }
      const newPairs=buildPairings(r,gPlayers,allPairings,allResults)
      // DB에 upsert
      const rows=newPairs.map(p=>({tournament_id:tid,group_name:g,round:r,...p}))
      const {error}=await dbRetry(()=>supabase.from('pairings').upsert(rows,{onConflict:'tournament_id,group_name,round,board'}))
      if(error) throw error
      // 옛 결과 삭제 (재생성 시)
      await supabase.from('results').delete().eq('tournament_id',tid).eq('group_name',g).eq('round',r)
      setPairingsCache(prev=>({...prev,[ck(g,r)]:newPairs}))
      setResultsCache(prev=>({...prev,[ck(g,r)]:{}}))
      showToast(`[${g}] ${r}라운드 대국 생성 완료 (보드 ${newPairs.length}개)`)
    } catch(e){ showToast(`오류: ${e.message}`) }
    setBusy(false)
  }

  /* ── 결과 입력 ── */
  const submitResult=async(g,r,board,value,extras={})=>{
    // 화면 즉시 반영
    setResultsCache(prev=>({...prev,[ck(g,r)]:{...(prev[ck(g,r)]||{}),[board]:{result:value,...extras}}}))
    const row={tournament_id:tid,group_name:g,round:r,board,result:value,...extras,updated_at:new Date().toISOString()}
    const {error}=await dbRetry(()=>supabase.from('results').upsert(row,{onConflict:'tournament_id,group_name,round,board'}))
    if(error) showToast(`저장 실패 — 다시 시도해주세요: ${error.message}`)
    else showToast(`${r}R 보드${board} 결과 저장됨`)
  }

  /* ── 순위 계산 ── */
  const refreshStandings=async(g,upTo)=>{
    setBusy(true)
    const allPairings={},allResults={}
    for(let r=1;r<=upTo;r++){
      await loadRound(g,r,true)
      allPairings[r]=(pairingsCache[ck(g,r)]||[])
      const rm=resultsCache[ck(g,r)]||{}
      allResults[r]=Object.fromEntries(Object.entries(rm).map(([b,v])=>[b,v.result]))
    }
    const rows=computeStandings(playersInGroup(g),allPairings,allResults,upTo,tournament?.tiebreaks||['buchholzCut1','sb','directEncounter'])
    setStandingsRows(rows)
    setBusy(false)
  }
  useEffect(()=>{ if(tid&&role&&standingsGroup&&tab==='standings') refreshStandings(standingsGroup,standingsRound) },[tab,standingsGroup,standingsRound,tid,role])

  /* ── 이름 조회 헬퍼 ── */
  const pOf=useCallback(id=>players.find(p=>p.id===id),[players])
  const nameOf=useCallback(id=>{
    const p=pOf(id); if(!p) return '(알수없음)'
    const dup=players.filter(x=>x.name===p.name)
    if(dup.length<=1) return p.name
    if(p.phone) return `${p.name}(${p.phone.slice(-4)})`
    const i=dup.findIndex(x=>x.id===id); return `${p.name}-${i+1}`
  },[players])

  const roundComplete=useCallback((g,r)=>{
    const pairs=pairingsCache[ck(g,r)]||[]; const res=resultsCache[ck(g,r)]||{}
    const real=pairs.filter(p=>!p.bye_id)
    return real.length>0&&real.every(p=>res[p.board]?.result)
  },[pairingsCache,resultsCache])

  if(loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white font-mono">로딩 중…</div>
  if(!tid||!tournament) return <TournamentSelector tournaments={tournaments} onSelect={id=>{setTid(id); setTournament(tournaments.find(t=>t.id===id))}} onNew={()=>setTab('new_tournament')}/>
  if(!role) return <PinScreen tournament={tournament} onLogin={r=>{setRole(r); setTab(r==='chief'?'pairings':'results')}}/>

  const numRounds=tournament.num_rounds||5
  const pairs=pairingsCache[ck(viewGroup,viewRound)]||[]
  const results=resultsCache[ck(viewGroup,viewRound)]||{}
  const refPairs=pairingsCache[ck(refGroup,refRound)]||[]
  const refResults=resultsCache[ck(refGroup,refRound)]||{}

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* 헤더 */}
      <div className="bg-slate-900 text-white px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-2">
            <Crown size={20} className="text-amber-400"/>
            <span className="font-bold text-base">{tournament.name}</span>
            <Badge color={role==='chief'?'amber':'blue'}>{role==='chief'?'심판장':'심판'}</Badge>
          </div>
          <button onClick={()=>setRole(null)} className="text-slate-400 hover:text-white"><LogOut size={18}/></button>
        </div>
        <p className="text-slate-400 text-xs mt-0.5 max-w-2xl mx-auto font-mono">
          {numRounds}라운드 · 선수 {players.length}명 · 그룹 {effectiveGroups.length}개
        </p>

        {/* 탭 */}
        <div className="flex gap-1.5 mt-3 max-w-2xl mx-auto">
          {role==='chief'&&[['pairings','대국배정',Shuffle],['standings','순위',Trophy],['settings','설정',Settings]].map(([k,l,I])=>(
            <button key={k} onClick={()=>setTab(k)} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium ${tab===k?'bg-amber-600 text-white':'bg-slate-800 text-slate-300'}`}>
              <I size={13}/>{l}
            </button>
          ))}
          {role==='referee'&&[['results','결과입력',ClipboardCheck],['standings','승점현황',Trophy]].map(([k,l,I])=>(
            <button key={k} onClick={()=>setTab(k)} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium ${tab===k?'bg-amber-600 text-white':'bg-slate-800 text-slate-300'}`}>
              <I size={13}/>{l}
            </button>
          ))}
        </div>
      </div>

      {toast&&<div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-4 py-2 text-center font-mono max-w-2xl mx-auto">{toast}</div>}

      <div className="max-w-2xl mx-auto p-3">

        {/* ── 심판장: 대국배정 ── */}
        {role==='chief'&&tab==='pairings'&&(
          <div className="space-y-3">
            <Card className="p-3 flex items-center gap-2 flex-wrap">
              <select value={viewGroup} onChange={e=>{setViewGroup(e.target.value);setViewRound(1)}} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0">
                {effectiveGroups.map(g=><option key={g} value={g}>{g} ({playersInGroup(g).length}명)</option>)}
              </select>
              <select value={viewRound} onChange={e=>setViewRound(Number(e.target.value))} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                {Array.from({length:numRounds},(_,i)=>i+1).map(r=><option key={r} value={r}>{r}R</option>)}
              </select>
              <button onClick={()=>loadRound(viewGroup,viewRound,true)} className="text-slate-400 hover:text-slate-700"><RefreshCw size={16}/></button>
            </Card>

            {pairs.length===0?(
              <Card className="p-5 text-center space-y-3">
                <p className="text-slate-500 text-sm font-mono">[{viewGroup}] {viewRound}라운드 대국이 아직 생성되지 않았습니다.</p>
                <Btn onClick={()=>generateRound(viewGroup,viewRound)} disabled={busy||(viewRound>1&&!roundComplete(viewGroup,viewRound-1))} className="mx-auto">
                  <Shuffle size={15}/>{viewRound}라운드 대국 생성
                </Btn>
                {viewRound>1&&!roundComplete(viewGroup,viewRound-1)&&<p className="text-rose-500 text-xs">{viewRound-1}라운드 결과가 모두 입력되어야 합니다.</p>}
              </Card>
            ):(
              <div className="space-y-2">
                {pairs.map(p=>{
                  const res=results[p.board]
                  if(p.bye_id) return <Card key={p.board} className="p-3 text-sm text-slate-500">보드{p.board} — {nameOf(p.bye_id)} 부전승</Card>
                  return (
                    <Card key={p.board} className="p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-slate-400 font-mono">보드 {p.board}</span>
                        {res?.result&&<Badge color="emerald">{res.result}</Badge>}
                      </div>
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="font-medium">⬜ {nameOf(p.white_id)}</span>
                        <Swords size={13} className="text-slate-400 mx-1"/>
                        <span className="font-medium text-right">⬛ {nameOf(p.black_id)}</span>
                      </div>
                      <ResultButtons g={viewGroup} r={viewRound} p={p} res={res} busy={busy} submit={submitResult}/>
                    </Card>
                  )
                })}
                {viewRound<numRounds&&roundComplete(viewGroup,viewRound)&&(
                  <Btn onClick={()=>{generateRound(viewGroup,viewRound+1);setViewRound(viewRound+1)}} disabled={busy} className="w-full justify-center">
                    {viewRound+1}라운드 생성 →
                  </Btn>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 심판: 결과입력 ── */}
        {role==='referee'&&tab==='results'&&(
          <div className="space-y-3">
            <Card className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500">그룹</label>
                  <select value={refGroup} onChange={e=>{setRefGroup(e.target.value);setRefRound(1)}} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm mt-0.5">
                    {effectiveGroups.map(g=><option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">라운드</label>
                  <select value={refRound} onChange={e=>setRefRound(Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm mt-0.5">
                    {Array.from({length:numRounds},(_,i)=>i+1).map(r=><option key={r} value={r}>{r}R</option>)}
                  </select>
                </div>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400"/>
                <input value={refSearch} onChange={e=>setRefSearch(e.target.value)} placeholder="보드번호 또는 이름 검색" className="w-full border border-slate-300 rounded-lg pl-8 py-2 text-sm"/>
              </div>
            </Card>

            {refPairs.length===0&&<Card className="p-4 text-center text-sm text-slate-500">대국이 아직 생성되지 않았습니다. 심판장에게 문의하세요.</Card>}

            {refPairs.filter(p=>{
              if(!refSearch.trim()) return true
              const q=refSearch.trim()
              if(String(p.board).includes(q)) return true
              if(p.bye_id) return nameOf(p.bye_id).includes(q)
              return nameOf(p.white_id).includes(q)||nameOf(p.black_id).includes(q)
            }).map(p=>{
              const res=refResults[p.board]
              if(p.bye_id) return <Card key={p.board} className="p-3 text-sm text-slate-500">보드{p.board} — {nameOf(p.bye_id)} 부전승</Card>
              return (
                <Card key={p.board} className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-slate-400 font-mono">보드 {p.board}</span>
                    {res?.result&&<Badge color="emerald">{res.result}</Badge>}
                  </div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-medium">⬜ {nameOf(p.white_id)}</span>
                    <Swords size={13} className="text-slate-400 mx-1"/>
                    <span className="font-medium text-right">⬛ {nameOf(p.black_id)}</span>
                  </div>
                  <ResultButtons g={refGroup} r={refRound} p={p} res={res} busy={busy} submit={submitResult}/>
                  {/* 경고/반칙 */}
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <PenaltyRow label="⬜ 경고/반칙" warnVal={res?.white_warnings||0} foulVal={res?.white_fouls||0}
                      onWarn={n=>submitResult(refGroup,refRound,p.board,res?.result||'',{...res,white_warnings:n})}
                      onFoul={n=>submitResult(refGroup,refRound,p.board,res?.result||'',{...res,white_fouls:n})}/>
                    <PenaltyRow label="⬛ 경고/반칙" warnVal={res?.black_warnings||0} foulVal={res?.black_fouls||0}
                      onWarn={n=>submitResult(refGroup,refRound,p.board,res?.result||'',{...res,black_warnings:n})}
                      onFoul={n=>submitResult(refGroup,refRound,p.board,res?.result||'',{...res,black_fouls:n})}/>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {/* ── 순위 ── */}
        {tab==='standings'&&(
          <div className="space-y-3">
            <Card className="p-3 flex items-center gap-2 flex-wrap">
              <select value={standingsGroup} onChange={e=>{setStandingsGroup(e.target.value)}} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0">
                {effectiveGroups.map(g=><option key={g} value={g}>{g}</option>)}
              </select>
              <select value={standingsRound} onChange={e=>setStandingsRound(Number(e.target.value))} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                {Array.from({length:numRounds},(_,i)=>i+1).map(r=><option key={r} value={r}>{r}R까지</option>)}
              </select>
              <button onClick={()=>refreshStandings(standingsGroup,standingsRound)} disabled={busy} className="text-slate-400 hover:text-slate-700"><RefreshCw size={16}/></button>
            </Card>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">순위</th>
                    <th className="text-left px-3 py-2">이름</th>
                    <th className="text-left px-3 py-2">점수</th>
                    {(tournament?.tiebreaks||['buchholzCut1','sb']).filter(t=>t!=='directEncounter').map(t=>(
                      <th key={t} className="text-left px-3 py-2">{TIEBREAK_DEFS[t]?.short||t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {standingsRows.map((r,i)=>(
                    <tr key={r.id} className={i<3?'bg-amber-50':''}>
                      <td className="px-3 py-2">{i+1}</td>
                      <td className="px-3 py-2 font-sans">{r.name}</td>
                      <td className="px-3 py-2 font-bold">{r.score}</td>
                      {(tournament?.tiebreaks||['buchholzCut1','sb']).filter(t=>t!=='directEncounter').map(t=>(
                        <td key={t} className="px-3 py-2">{r[t]??'-'}</td>
                      ))}
                    </tr>
                  ))}
                  {standingsRows.length===0&&<tr><td colSpan="10" className="px-3 py-6 text-center text-slate-400">데이터가 없습니다.</td></tr>}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* ── 설정 (심판장 전용) ── */}
        {role==='chief'&&tab==='settings'&&(
          <SettingsTab tid={tid} tournament={tournament} players={players} onUpdate={()=>{loadPlayers();loadTournaments()}} showToast={showToast}/>
        )}
      </div>
    </div>
  )
}

/* ── 결과 버튼 컴포넌트 ── */
function ResultButtons({g,r,p,res,busy,submit}){
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {[['1-0','백 승','dark'],['1/2-1/2','무승부','ghost'],['0-1','흑 승','dark']].map(([v,l,vt])=>(
        <button key={v} onClick={()=>submit(g,r,p.board,v,{white_warnings:res?.white_warnings||0,white_fouls:res?.white_fouls||0,black_warnings:res?.black_warnings||0,black_fouls:res?.black_fouls||0})} disabled={busy}
          className={`text-xs py-2 rounded-lg font-medium transition active:scale-95 ${res?.result===v?(v==='1/2-1/2'?'bg-amber-600 text-white':'bg-slate-900 text-white'):'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

/* ── 경고/반칙 카운터 ── */
function PenaltyRow({label,warnVal,foulVal,onWarn,onFoul}){
  return (
    <div className="bg-slate-50 rounded-lg p-2 space-y-1">
      <p className="text-slate-500 font-medium">{label}</p>
      <div className="flex items-center justify-between">
        <span className="text-slate-500">경고</span>
        <div className="flex items-center gap-1">
          <button onClick={()=>onWarn(Math.max(0,warnVal-1))} className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-slate-700">-</button>
          <span className="w-5 text-center font-mono">{warnVal}</span>
          <button onClick={()=>onWarn(warnVal+1)} className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-slate-700">+</button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-rose-500">반칙</span>
        <div className="flex items-center gap-1">
          <button onClick={()=>onFoul(Math.max(0,foulVal-1))} className="w-6 h-6 rounded bg-rose-100 flex items-center justify-center text-rose-700">-</button>
          <span className="w-5 text-center font-mono text-rose-700">{foulVal}</span>
          <button onClick={()=>onFoul(foulVal+1)} className="w-6 h-6 rounded bg-rose-100 flex items-center justify-center text-rose-700">+</button>
        </div>
      </div>
    </div>
  )
}

/* ── 대회 선택 화면 ── */
function TournamentSelector({tournaments,onSelect,onNew}){
  const [name,setName]=useState('')
  const [creating,setCreating]=useState(false)

  const create=async()=>{
    if(!name.trim()) return
    setCreating(true)
    const {data}=await dbRetry(()=>supabase.from('tournaments').insert({name:name.trim(),chief_pin:'0000',referee_pin:'1234'}).select().single())
    if(data) onSelect(data.id)
    setCreating(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-sm w-full space-y-4">
        <div className="text-center">
          <Crown size={36} className="text-amber-400 mx-auto mb-2"/>
          <h1 className="text-white font-bold text-xl">체스 스위스 매니저</h1>
        </div>
        {tournaments.length>0&&(
          <Card className="p-4 space-y-2">
            <p className="text-sm font-medium text-slate-700">기존 대회 선택</p>
            {tournaments.map(t=>(
              <button key={t.id} onClick={()=>onSelect(t.id)} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 text-sm">
                <p className="font-medium">{t.name}</p>
                <p className="text-slate-400 text-xs">{new Date(t.created_at).toLocaleDateString('ko-KR')}</p>
              </button>
            ))}
          </Card>
        )}
        <Card className="p-4 space-y-3">
          <p className="text-sm font-medium text-slate-700">새 대회 만들기</p>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="대회명" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"/>
          <Btn onClick={create} disabled={creating||!name.trim()} className="w-full justify-center"><Plus size={15}/>대회 생성</Btn>
        </Card>
      </div>
    </div>
  )
}

/* ── 설정 탭 ── */
function SettingsTab({tid,tournament,players,onUpdate,showToast}){
  const [cfg,setCfg]=useState({name:tournament.name,num_rounds:tournament.num_rounds||5,groups:tournament.groups||[],chief_pin:tournament.chief_pin||'0000',referee_pin:tournament.referee_pin||'1234',tiebreaks:tournament.tiebreaks||['buchholzCut1','sb','directEncounter']})
  const [newGroup,setNewGroup]=useState('')
  const [importText,setImportText]=useState('')
  const [showImport,setShowImport]=useState(false)
  const [busy,setBusy]=useState(false)

  const save=async()=>{
    setBusy(true)
    const {error}=await dbRetry(()=>supabase.from('tournaments').update(cfg).eq('id',tid))
    if(error) showToast('저장 실패: '+error.message)
    else { showToast('설정이 저장되었습니다.'); onUpdate() }
    setBusy(false)
  }

  const addPlayer=async(name,phone,gender,group,rating)=>{
    const {error}=await dbRetry(()=>supabase.from('players').insert({tournament_id:tid,name,phone,gender,group_name:group,rating:Number(rating)||0}))
    if(error) showToast('추가 실패: '+error.message)
    else onUpdate()
  }

  const removePlayer=async(id)=>{
    await dbRetry(()=>supabase.from('players').delete().eq('id',id))
    onUpdate()
  }

  const importCsv=async(text)=>{
    const r=Papa.parse(text.trim(),{header:true,skipEmptyLines:true})
    const rows=r.data; let added=0
    const SYNONYMS={name:['이름','성명','참가자','참가선수','선수','name'],phone:['전화번호','연락처','휴대폰','phone'],gender:['남여구분','남녀구분','성별','gender'],group:['학년','그룹','조','group'],rating:['레이팅','rating','등급','점수']}
    const find=(rowObj,field)=>{
      const keys=Object.keys(rowObj)
      const syn=SYNONYMS[field]||[]
      const k=keys.find(k=>syn.some(s=>k.replace(/\s/g,'').toLowerCase().includes(s.toLowerCase())))
      return k?String(rowObj[k]||'').trim():''
    }
    const normalize=(raw)=>{
      const s=(raw||'').trim()
      const m=s.match(/초\s*(?:등부)?\s*(\d)\s*학년/); if(m) return `초등-${m[1]}`
      if(/유치/.test(s)) return '유치부'
      if(/일반/.test(s)) return '일반부'
      if(/중\s*(?:등부)?|고\s*(?:등부)?/.test(s)) return '중고등부'
      return s
    }
    setBusy(true)
    for(const row of rows){
      const name=find(row,'name'); if(!name) continue
      const group=normalize(find(row,'group'))
      await dbRetry(()=>supabase.from('players').insert({tournament_id:tid,name,phone:find(row,'phone'),gender:find(row,'gender'),group_name:group,rating:Number(find(row,'rating'))||0}))
      added++
    }
    setBusy(false)
    onUpdate()
    showToast(`${added}명 등록되었습니다.`)
    setImportText('')
  }

  const sortedGroups=sortGroups(cfg.groups)

  return (
    <div className="space-y-4">
      {/* 대회 정보 */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-medium text-slate-700"><Settings size={16} className="text-amber-600"/>대회 정보</div>
        <div><label className="text-xs text-slate-500">대회명</label><input value={cfg.name} onChange={e=>setCfg({...cfg,name:e.target.value})} className="w-full border rounded-lg px-3 py-2 mt-0.5 text-sm"/></div>
        <div><label className="text-xs text-slate-500">총 라운드</label><input type="number" min={1} value={cfg.num_rounds} onChange={e=>setCfg({...cfg,num_rounds:Number(e.target.value)})} className="w-24 border rounded-lg px-3 py-2 mt-0.5 text-sm block"/></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-slate-500">심판장 PIN</label><input value={cfg.chief_pin} onChange={e=>setCfg({...cfg,chief_pin:e.target.value})} className="w-full border rounded-lg px-3 py-2 mt-0.5 text-sm"/></div>
          <div><label className="text-xs text-slate-500">심판 PIN</label><input value={cfg.referee_pin} onChange={e=>setCfg({...cfg,referee_pin:e.target.value})} className="w-full border rounded-lg px-3 py-2 mt-0.5 text-sm"/></div>
        </div>
        <Btn onClick={save} disabled={busy} className="w-full justify-center">설정 저장</Btn>
      </Card>

      {/* 그룹 관리 */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-medium text-slate-700"><Users size={16} className="text-amber-600"/>그룹(학년) 관리</div>
        <div className="flex flex-wrap gap-2">
          {sortedGroups.map(g=>(
            <span key={g} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs rounded-full px-3 py-1">
              {g} ({players.filter(p=>p.group_name===g).length}명)
              <button onClick={()=>setCfg({...cfg,groups:cfg.groups.filter(x=>x!==g)})} className="text-slate-400 hover:text-rose-600"><X size={11}/></button>
            </span>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-xs text-slate-400">빠른 추가</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_GROUPS.filter(g=>!cfg.groups.includes(g)).map(g=>(
              <button key={g} onClick={()=>setCfg({...cfg,groups:[...cfg.groups,g]})} className="text-xs border border-slate-300 rounded-full px-3 py-1 hover:border-amber-500 text-slate-600">+{g}</button>
            ))}
            <button onClick={()=>setCfg({...cfg,groups:[...new Set([...cfg.groups,...PRESET_GROUPS])]})} className="text-xs text-amber-700 hover:underline">한번에 모두</button>
          </div>
        </div>
        <div className="flex gap-2">
          <input value={newGroup} onChange={e=>setNewGroup(e.target.value)} placeholder="그룹명 직접 입력" className="flex-1 border rounded-lg px-3 py-2 text-sm"/>
          <Btn onClick={()=>{if(newGroup.trim()&&!cfg.groups.includes(newGroup.trim())){setCfg({...cfg,groups:[...cfg.groups,newGroup.trim()]});setNewGroup('')}}}><Plus size={15}/></Btn>
        </div>
      </Card>

      {/* 선수 명단 */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-slate-700"><Users size={16} className="text-amber-600"/>선수 명단 ({players.length}명)</div>
          <button onClick={()=>setShowImport(s=>!s)} className="text-xs text-amber-700 hover:underline flex items-center gap-1"><Upload size={13}/>CSV 가져오기</button>
        </div>
        {showImport&&(
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
            <p className="text-xs text-slate-600">이름·전화번호·남여구분·학년 컬럼의 CSV를 붙여넣으세요. 학년 값은 자동 정규화됩니다.</p>
            <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder={'이름,전화번호,남여구분,학년\n홍길동,010-1234-5678,남,초등부 3학년'} className="w-full h-24 border rounded-lg px-2 py-1.5 text-xs font-mono"/>
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" size="sm" onClick={()=>{setShowImport(false);setImportText('')}}>닫기</Btn>
              <Btn size="sm" onClick={()=>importCsv(importText)} disabled={!importText.trim()||busy}>가져오기</Btn>
            </div>
          </div>
        )}
        <AddPlayerForm groups={sortGroups(cfg.groups)} onAdd={addPlayer}/>
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {players.length===0&&<p className="text-sm text-slate-400 p-3 text-center">등록된 선수가 없습니다.</p>}
          {players.map(p=>(
            <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{p.name} {p.group_name&&<Badge color="slate">{p.group_name}</Badge>} {p.rating>0&&<span className="text-slate-400 font-mono text-xs ml-1">({p.rating})</span>}</span>
              <button onClick={()=>removePlayer(p.id)} className="text-slate-300 hover:text-rose-600"><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function AddPlayerForm({groups,onAdd}){
  const [f,setF]=useState({name:'',phone:'',gender:'',group:'',rating:''})
  const add=()=>{ if(!f.name.trim()) return; onAdd(f.name.trim(),f.phone.trim(),f.gender,f.group,f.rating); setF({name:'',phone:'',gender:'',group:'',rating:''}) }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="이름" className="border rounded-lg px-3 py-2 text-sm"/>
        <input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})} placeholder="전화번호" className="border rounded-lg px-3 py-2 text-sm"/>
        <select value={f.gender} onChange={e=>setF({...f,gender:e.target.value})} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">성별</option><option value="남">남</option><option value="여">여</option>
        </select>
        <select value={f.group} onChange={e=>setF({...f,group:e.target.value})} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">그룹 선택</option>
          {groups.map(g=><option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <Btn onClick={add} className="w-full justify-center"><Plus size={15}/>선수 추가</Btn>
    </div>
  )
}
