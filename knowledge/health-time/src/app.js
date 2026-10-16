(() => {
  'use strict';
  const base = window.HealthKnowledgeData;
  const STORE_KEY = 'health-time-kb-custom-v1';
  const $ = (id) => document.getElementById(id);
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const knownEvidence = ['指南／標準','研究指標','程式自訂','待查證','指南換算','標準測量','研究測量','個人化試算','研究／描述','資料比較','粗略估算','研究方法','生理估算','研究／估算','工程自訂','研究指標'];
  function readCustom() {
    try { const value = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(value) ? value.filter(validItem) : []; }
    catch { return []; }
  }
  function validItem(item) {
    return !!item && typeof item === 'object' && ['exercise','rest'].includes(item.domain) &&
      ['id','name','equation','method','evidence','category'].every(k => typeof item[k] === 'string' && item[k].trim()) &&
      item.name.length <= 100 && item.equation.length <= 200 && item.method.length <= 400 &&
      (!item.sourceUrls || (Array.isArray(item.sourceUrls) && item.sourceUrls.every(u => {try{return ['http:','https:'].includes(new URL(u).protocol)}catch{return false}})));
  }
  let customItems = readCustom();
  const sourceById = Object.fromEntries(base.sources.map(x => [x.id,x]));
  function relatedSources(item) {
    if (item.sourceUrls?.length) return item.sourceUrls.map((url,i)=>({title:`自訂來源 ${i+1}`,url}));
    const c=item.category||'', n=item.name||'', d=item.domain;
    let ids=[];
    if(d==='exercise') {
      if(/久坐|中斷/.test(c+n)) ids=['S04','S05'];
      else if(/RPE|負荷|強度/.test(c+n)) ids=['S02','S20'];
      else if(/休息|恢復/.test(c+n)) ids=['S05','S02'];
      else ids=['S01','S02','S03'];
    } else if(/規律|社交時差|中點/.test(c+n)) ids=['S13','S14','S15','S16'];
    else if(/午睡|慣性/.test(c+n)) ids=['S17','S18','S19'];
    else if(/工作休息|休息比|工作後|工作時段/.test(c+n)) ids=['S05'];
    else if(/睡眠效率|TIB|TST|SOL|WASO|醒/.test(c+n)) ids=['S11','S12'];
    else ids=['S06','S07','S08','S09','S10'];
    return ids.map(id=>sourceById[id]).filter(Boolean);
  }
  function evidenceClass(value) {
    if (/自訂|試算|估算/.test(value)) return 'custom';
    if (/研究/.test(value)) return 'research';
    if (/待查/.test(value)) return 'pending';
    return '';
  }
  function renderCard(item,index) {
    const sources=relatedSources(item);
    const cite=sources.length ? `<div class="source-links"><b>參考：</b>${sources.map(s=>`<a href="${escapeHTML(s.url)}" target="_blank" rel="noopener">${escapeHTML(s.title)}</a>`).join(' · ')}</div>` : '<div class="source-links muted">尚未附文獻來源，需後續核對。</div>';
    return `<article class="formula"><div class="formula-head"><h3>${index+1}. ${escapeHTML(item.name)}</h3>${item.customId?`<button class="delete-entry" data-delete="${escapeHTML(item.customId)}" aria-label="刪除自訂條目">刪除</button>`:''}</div><span class="tag ${evidenceClass(item.evidence)}">${escapeHTML(item.evidence)}</span><div class="equation">${escapeHTML(item.equation)}</div><p><b>${escapeHTML(item.category)}</b> · ${escapeHTML(item.method)}</p>${cite}</article>`;
  }
  function renderList(list,target,searchId,filterId) {
    const query=$(searchId).value.trim().toLocaleLowerCase();
    const category=$(filterId).value;
    const filtered=list.filter(item => (category==='all'||item.category===category) && (!query || [item.name,item.equation,item.method,item.evidence,item.category].join(' ').toLocaleLowerCase().includes(query)));
    $(target).innerHTML=filtered.map(renderCard).join('') || '<p class="muted">沒有符合項目。清除搜尋或切換分類再試一次。</p>';
    $(target).querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>removeCustom(button.dataset.delete)));
  }
  function setCategories(list,select) {
    const previous=$(select).value;
    $(select).innerHTML='<option value="all">全部分類</option>';
    [...new Set(list.map(x=>x.category))].sort((a,b)=>a.localeCompare(b,'zh-Hant')).forEach(c=>$(select).insertAdjacentHTML('beforeend',`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`));
    if([...$(select).options].some(o=>o.value===previous)) $(select).value=previous;
  }
  function refresh() {
    const exercise=[...base.exercise,...customItems.filter(x=>x.domain==='exercise')];
    const rest=[...base.rest,...customItems.filter(x=>x.domain==='rest')];
    setCategories(exercise,'exFilter'); setCategories(rest,'slFilter');
    $('exCount').textContent=`${exercise.length} 項`; $('slCount').textContent=`${rest.length} 項`;
    renderList(exercise,'exList','exSearch','exFilter'); renderList(rest,'slList','slSearch','slFilter');
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY,JSON.stringify(customItems)); return true; }
    catch { $('entryStatus').textContent='瀏覽器無法保存；請先匯出本機條目。'; return false; }
  }
  function removeCustom(id) {
    customItems=customItems.filter(x=>x.customId!==id); persist(); refresh();
  }
  function addCustom(item) {
    const id=`custom-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    customItems.push({...item,id,customId:id}); persist(); refresh();
    $('entryStatus').textContent='已加入本機知識庫。記得匯出 JSON 備份，否則清除瀏覽器資料會遺失。';
  }
  function setActiveView(view) {
    document.querySelectorAll('.tab').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
    document.querySelectorAll('.view').forEach(section=>section.classList.toggle('hidden',section.id!==view));
  }
  document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>setActiveView(button.dataset.view)));
  $('exSearch').addEventListener('input',refresh); $('slSearch').addEventListener('input',refresh);
  $('exFilter').addEventListener('change',refresh); $('slFilter').addEventListener('change',refresh);
  $('exerciseLaws').innerHTML=base.exerciseLaws.map((x,i)=>`<div class="law"><b>${i+1}.</b> ${escapeHTML(x)}</div>`).join('');
  $('sleepLaws').innerHTML=base.sleepLaws.map((x,i)=>`<div class="law"><b>${i+1}.</b> ${escapeHTML(x)}</div>`).join('');
  $('cautions').innerHTML=base.cautions.map(x=>`<li>${escapeHTML(x)}</li>`).join('');
  $('sourceList').innerHTML=base.sources.map(s=>`<li><a href="${escapeHTML(s.url)}" target="_blank" rel="noopener">${escapeHTML(s.title)}</a> <span class="muted">(${s.id})</span></li>`).join('');
  function minutes(time) { if(!/^\d{2}:\d{2}$/.test(time||'')) return null; const [h,m]=time.split(':').map(Number); return h<24&&m<60?h*60+m:null; }
  $('calcExercise').addEventListener('click',()=>{
    const moderate=Number($('mod').value),vigorous=Number($('vig').value),strength=Number($('strength').value);
    if(![moderate,vigorous,strength].every(Number.isFinite)||moderate<0||vigorous<0||moderate>10080||vigorous>10080||strength<0||strength>7){$('exerciseResult').textContent='請輸入有效的非負分鐘數；肌力天數請填 0–7。';return;}
    const equivalent=moderate+2*vigorous, deficit=Math.max(0,150-equivalent);
    $('exerciseResult').innerHTML=`<b>中等強度等值分鐘：${equivalent} 分／週</b><div class="kpi"><span>距 150 分參考下限：${deficit} 分</span><span>肌力：${strength}/2 天</span><span>參考下限進度：${Math.round(equivalent/150*100)}%</span></div><p>${equivalent>=150?'達到成人每週有氧活動最低參考量。':'低於成人每週有氧活動最低參考量；已完成活動仍照實保留。'} ${strength>=2?'肌力天數達到每週至少 2 天參考量。':'肌力天數未達每週至少 2 天參考量。'}</p><small>此換算是指南追蹤方式，不是醫療診斷或個人化處方。</small>`;
  });
  $('calcSleep').addEventListener('click',()=>{
    const bed=minutes($('bed').value),rise=minutes($('rise').value),sol=Number($('sol').value),waso=Number($('waso').value),tfa=Number($('tfa').value),target=Number($('target').value);
    if(bed===null||rise===null||![sol,waso,tfa,target].every(Number.isFinite)||[sol,waso,tfa].some(x=>x<0||x>1440)||target<1||target>16){$('sleepResult').textContent='請檢查時間與數字；分鐘不可為負，目標需介於 1–16 小時。';return;}
    let tib=(rise-bed+1440)%1440; if(tib===0)tib=1440;
    if(sol+waso+tfa>tib){$('sleepResult').textContent='輸入的清醒時間總和超過臥床時間，請檢查紀錄。';return;}
    const tst=tib-sol-waso-tfa,se=100*tst/tib,gap=Math.max(0,target*60-tst);
    $('sleepResult').innerHTML=`<b>估算總睡眠：${(tst/60).toFixed(2)} 小時</b><div class="kpi"><span>臥床時間：${(tib/60).toFixed(2)} 小時</span><span>睡眠效率 TST/TIB：${se.toFixed(1)}%</span><span>與個人目標差：${gap} 分鐘</span></div><small>睡眠日誌估算值；睡眠效率不能單獨診斷睡眠問題。</small>`;
  });
  $('addEntryToggle').addEventListener('click',()=>{$('entryForm').classList.toggle('hidden'); $('entryStatus').textContent='';});
  $('cancelEntry').addEventListener('click',()=>{$('entryForm').reset();$('entryForm').classList.add('hidden');$('entryStatus').textContent='';});
  $('entryForm').addEventListener('submit',(event)=>{
    event.preventDefault();
    const url=$('entrySource').value.trim();
    if(url){try{if(!['http:','https:'].includes(new URL(url).protocol))throw Error();}catch{$('entryStatus').textContent='來源網址需使用 http 或 https。';return;}}
    const item={domain:$('entryDomain').value,evidence:$('entryType').value,category:$('entryCategory').value.trim(),name:$('entryName').value.trim(),equation:$('entryEquation').value.trim(),method:$('entryMethod').value.trim(),sourceUrls:url?[url]:[]};
    const candidate={...item,id:'custom-check'};
    if(!validItem(candidate)){$('entryStatus').textContent='請填完整資料，並確認欄位長度。';return;}
    addCustom(item); $('entryForm').reset(); setActiveView(item.domain==='exercise'?'exercise':'rest'); $('entryForm').classList.add('hidden');
  });
  $('exportKnowledge').addEventListener('click',()=>{
    const payload={schemaVersion:1,kind:'health-time-kb-custom-items',exportedAt:new Date().toISOString(),items:customItems.map(({customId,...item})=>item)};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='health-time-kb-custom.json';link.click();URL.revokeObjectURL(url);
  });
  $('importKnowledge').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async(event)=>{
    const file=event.target.files?.[0]; if(!file)return;
    try {
      if(file.size>2_000_000)throw Error('檔案超過 2 MB。');
      const payload=JSON.parse(await file.text());
      if(payload.schemaVersion!==1||payload.kind!=='health-time-kb-custom-items'||!Array.isArray(payload.items))throw Error('格式不符。請使用本知識庫匯出的 JSON 格式。');
      if(payload.items.length>500)throw Error('單次匯入最多 500 筆。');
      const invalid=payload.items.find(x=>!validItem(x)); if(invalid)throw Error('檔案中有格式錯誤或來源網址不安全的條目。');
      const map=new Map(customItems.map(x=>[x.id,x])); payload.items.forEach(x=>map.set(x.id,{...x,customId:x.id}));
      customItems=[...map.values()]; persist(); refresh(); $('entryStatus').textContent=`匯入完成：讀取 ${payload.items.length} 筆，自訂知識目前共 ${customItems.length} 筆。`;
    } catch(error) { $('entryStatus').textContent=`匯入失敗：${error.message}`; }
    event.target.value='';
  });
  refresh();
})();
