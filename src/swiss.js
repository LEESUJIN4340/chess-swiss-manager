/* 스위스 페어링 (더치 시스템 간소화) */
export function buildPairings(round, players, allPairings, allResults) {
  const score = {}, opponents = {}, colorCount = {}, hadBye = {}
  players.forEach(p => { score[p.id]=0; opponents[p.id]=new Set(); colorCount[p.id]={w:0,b:0}; hadBye[p.id]=false })

  for (let r = 1; r < round; r++) {
    ;(allPairings[r]||[]).forEach(pr => {
      if (pr.bye_id) { score[pr.bye_id]=(score[pr.bye_id]||0)+1; hadBye[pr.bye_id]=true; return }
      const res = (allResults[r]||{})[pr.board]
      opponents[pr.white_id]?.add(pr.black_id); opponents[pr.black_id]?.add(pr.white_id)
      colorCount[pr.white_id].w++; colorCount[pr.black_id].b++
      if (!res) return
      if (res==='1-0') score[pr.white_id]++
      else if (res==='0-1') score[pr.black_id]++
      else if (res==='1/2-1/2') { score[pr.white_id]+=0.5; score[pr.black_id]+=0.5 }
    })
  }

  const groups = {}
  players.forEach(p => { const s=score[p.id]||0; (groups[s]=groups[s]||[]).push(p) })
  const sortedScores = Object.keys(groups).map(Number).sort((a,b)=>b-a)

  let pool=[], boardNum=1, result=[]
  sortedScores.forEach(s => {
    let group=[...pool,...groups[s]].sort((a,b)=>b.rating-a.rating)
    pool=[]
    if (group.length%2!==0) pool.push(group.pop())
    const half=group.length/2
    const top=group.slice(0,half)
    let bottomPool=group.slice(half)
    top.forEach(t => {
      let idx=0,attempts=0
      while (attempts<bottomPool.length && opponents[t.id]?.has(bottomPool[idx]?.id)) { idx=(idx+1)%bottomPool.length; attempts++ }
      const opp=bottomPool[idx]; if(!opp) return
      bottomPool.splice(idx,1)
      let white=t,black=opp
      if ((colorCount[t.id].w-colorCount[t.id].b)>(colorCount[opp.id].w-colorCount[opp.id].b)) { white=opp; black=t }
      result.push({ board:boardNum++, white_id:white.id, black_id:black.id })
    })
  })
  if (pool.length) {
    pool.sort((a,b)=>(hadBye[a.id]-hadBye[b.id])||(a.rating-b.rating))
    pool.forEach(p => result.push({ board:boardNum++, bye_id:p.id }))
  }
  return result
}

/* 순위/타이브레이크 계산 */
export function computeStandings(players, allPairings, allResults, uptoRound, tiebreakOrder) {
  const score={}, gamesMap={}, oppList={}, byeCount={}
  players.forEach(p => { score[p.id]=0; gamesMap[p.id]={}; oppList[p.id]=[]; byeCount[p.id]=0 })

  for (let r=1; r<=uptoRound; r++) {
    ;(allPairings[r]||[]).forEach(pr => {
      if (pr.bye_id) { score[pr.bye_id]=(score[pr.bye_id]||0)+1; byeCount[pr.bye_id]++; return }
      const res=(allResults[r]||{})[pr.board]
      if (!res) return
      if (res==='1-0') score[pr.white_id]++
      else if (res==='0-1') score[pr.black_id]++
      else if (res==='1/2-1/2') { score[pr.white_id]+=0.5; score[pr.black_id]+=0.5 }
      const wRes=res==='1-0'?'win':res==='0-1'?'loss':'draw'
      const bRes=res==='1-0'?'loss':res==='0-1'?'win':'draw'
      gamesMap[pr.white_id][pr.black_id]={result:wRes}; gamesMap[pr.black_id][pr.white_id]={result:bRes}
      oppList[pr.white_id].push(pr.black_id); oppList[pr.black_id].push(pr.white_id)
    })
  }
  players.forEach(p => { score[p.id]=(score[p.id]||0)+(Number(p.adjustment)||0) })
  const rOf={}; players.forEach(p=>rOf[p.id]=p.rating||0)

  const rows=players.map(p => {
    const opps=oppList[p.id]||[]
    const oppScores=opps.map(o=>score[o]||0)
    const buchholz=oppScores.reduce((a,b)=>a+b,0)
    const buchholzCut1=oppScores.length>1?buchholz-Math.min(...oppScores):buchholz
    let sb=0
    opps.forEach(o=>{ const g=gamesMap[p.id]?.[o]; const os=score[o]||0; if(!g) return; if(g.result==='win') sb+=os; else if(g.result==='draw') sb+=os/2 })
    const wins=opps.filter(o=>gamesMap[p.id]?.[o]?.result==='win').length
    const avgOppRating=opps.length?Math.round(opps.reduce((a,o)=>a+(rOf[o]||0),0)/opps.length):0
    return { ...p, score:score[p.id], buchholz, buchholzCut1, sb, wins, avgOppRating, gamesMap:gamesMap[p.id] }
  })

  rows.sort((a,b) => {
    if (b.score!==a.score) return b.score-a.score
    for (const tb of (tiebreakOrder||[])) {
      if (tb==='directEncounter') {
        const g=a.gamesMap?.[b.id]
        if (g) { if(g.result==='win') return -1; if(g.result==='loss') return 1 }
        continue
      }
      const diff=(b[tb]??0)-(a[tb]??0)
      if (Math.abs(diff)>1e-9) return diff
    }
    return (a.name||'').localeCompare(b.name||'','ko')
  })
  return rows
}
